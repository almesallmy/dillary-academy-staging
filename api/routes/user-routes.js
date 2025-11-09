// api/routes/user-routes.js
// Purpose: User CRUD + admin/student listing, with Clerk auth and least-privilege data exposure.
//
// Conventions used here
// - Every route that reads multiple users or arbitrary users is restricted to admin/instructor.
// - Self-service routes check Clerk session -> resolve to Mongo user via clerkId.
// - Queries use field projection + .lean() where safe to reduce payload & memory.
// - Class roster edits on user delete are handled, no Conversation model reference.

import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import User from "../schemas/User.js";
import Class from "../schemas/Class.js";
import { clerkClient } from "@clerk/express";
import { validateInput } from "../../src/utils/backend/validate-utils.js";
import { requireAuth, requireAdminOrInstructor } from "../middleware/auth.js";

const router = express.Router();

// -----------------------------
// Helpers
// -----------------------------

/** Return true if the user doc has admin or instructor privilege. */
const isAdminOrInstructor = (u) => !!u && ["admin", "instructor"].includes(u.privilege);

/**
 * Resolve current requester ("me") by Clerk session.
 * Assumes requireAuth already ran and set req.auth.userId.
 */
async function getMe(req) {
  const clerkId = req.auth?.userId;
  if (!clerkId) return null;
  return User.findOne({ clerkId }).select("privilege").lean();
}

/**
 * Gate: allow if requester is admin/instructor OR requesting their own Mongo _id.
 * Expects :id in route params.
 */
async function allowSelfOrPriv(req, res, next) {
  try {
    const me = await getMe(req);
    if (isAdminOrInstructor(me)) return next();

    const paramId = req.params?.id;
    if (!paramId || !mongoose.Types.ObjectId.isValid(paramId)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    // Look up the target user and compare IDs
    const target = await User.findById(paramId).select("_id clerkId").lean();
    if (!target) return res.status(404).json({ message: "User not found" });

    const isSelf = target && req.auth?.userId && target.clerkId === req.auth.userId;
    return isSelf ? next() : res.status(403).json({ message: "Forbidden" });
  } catch (err) {
    console.error("allowSelfOrPriv error:", err);
    res.status(500).json({ message: "Auth check failed" });
  }
}

// -----------------------------
// Public signup
// -----------------------------

// Sign up (public) – creates Mongo profile after Clerk account creation on the client.
router.post("/sign-up", async (req, res) => {
  try {
    const { firstName, lastName, email, whatsapp, clerkId } = req.body;

    if (!firstName || !lastName || !email || !clerkId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const existingUser = await User.findOne({ email }).select("_id").lean();
    if (existingUser) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const newUser = await new User({ firstName, lastName, email, whatsapp, clerkId }).save();
    res.status(201).json(newUser);
  } catch (error) {
    console.error("Failed to sign up:", error);
    res.status(500).json({ message: "Failed to sign up" });
  }
});

// -----------------------------
// Admin: list many users (restricted)
// -----------------------------

// Get Users (admin/instructor only); returns minimal profile fields.
router.get("/users", requireAuth, requireAdminOrInstructor, async (_req, res) => {
  try {
    const users = await User.find({})
      .select("firstName lastName email privilege creationDate")
      .lean();
    return res.status(200).json(users);
  } catch (err) {
    console.error("Get users error:", err);
    res.status(500).send(err);
  }
});

// -----------------------------
// Self or Admin: read/update/delete single user
// -----------------------------

// Get User – admins can query arbitrary user via filters; non-admins get self.
router.get("/user", requireAuth, async (req, res) => {
  try {
    const allowedFields = ["_id", "email", "whatsapp"];
    const filters = validateInput(req.query, allowedFields);

    const me = await getMe(req);
    const isPriv = isAdminOrInstructor(me);

    let user;
    if (isPriv && Object.keys(filters).length) {
      user = await User.findOne(filters).lean();
    } else {
      // Non-admin/instructor: return own profile
      const clerkId = req.auth.userId;
      user = await User.findOne({ clerkId }).lean();
    }

    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user);
  } catch (err) {
    console.error("Get user error:", err);
    res.status(500).send(err);
  }
});

// Edit user – self or admin/instructor
router.put("/user/:id", requireAuth, allowSelfOrPriv, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const originalUser = await User.findById(id);
    if (!originalUser) return res.status(404).json({ message: "User not found" });

    // If email changes, mirror in Clerk
    if (updates.email && originalUser.email !== updates.email) {
      // Add new primary email on Clerk
      await clerkClient.emailAddresses.createEmailAddress({
        userId: originalUser.clerkId,
        emailAddress: updates.email,
        verified: true,
        primary: true,
      });

      // Remove old email from Clerk
      const clerkUser = await clerkClient.users.getUser(originalUser.clerkId);
      const oldEmail = clerkUser.emailAddresses.find(
        (e) => e.emailAddress === originalUser.email
      );
      if (oldEmail?.id) {
        await clerkClient.emailAddresses.deleteEmailAddress(oldEmail.id);
      }
    }

    const updatedUser = await User.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error("Failed to update user:", error);
    res.status(500).json({ message: "Failed to update user" });
  }
});

// Delete User – admin/instructor only
router.delete("/user/:id", requireAuth, requireAdminOrInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const deletedUser = await User.findById(id);
    if (!deletedUser) return res.status(404).json({ message: "User not found" });

    // Remove the user from any class rosters
    if (Array.isArray(deletedUser.enrolledClasses) && deletedUser.enrolledClasses.length) {
      await Promise.all(
        deletedUser.enrolledClasses.map((classId) =>
          Class.findByIdAndUpdate(classId, { $pull: { roster: id } }).catch((err) => {
            console.error(
              `Failed to remove user ${id} from class ${classId} roster:`,
              err
            );
            throw err;
          })
        )
      );
    }

    // Delete Clerk user, then Mongo user
    await clerkClient.users.deleteUser(deletedUser.clerkId);
    await User.findByIdAndDelete(id);

    res.status(204).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Failed to delete user:", error);
    res.status(500).json({ message: "Failed to delete user" });
  }
});

// -----------------------------
// Student class views
// -----------------------------

// Get student's classes (full details) – self or admin/instructor
router.get(
  "/students-classes/:id",
  requireAuth,
  allowSelfOrPriv,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid ID" });
      }

      const classDetails = await User.findById(id)
        .select("enrolledClasses")
        .populate("enrolledClasses") // admin/instructor need full; students see their own
        .lean();

      if (!classDetails) return res.status(404).json({ message: "User not found" });
      res.json(classDetails.enrolledClasses || []);
    } catch (err) {
      console.error("students-classes error:", err);
      res.status(500).send(err);
    }
  }
);

// -----------------------------
// Admin Students (paginated)
// -----------------------------

// GET /api/students-with-classes?limit=100&page=1
// Purpose: Replace N+1 per-student fetches with ONE paginated response.
// Security: Clerk session + app role (admin or instructor) required.
router.get(
  "/students-with-classes",
  requireAuth,
  requireAdminOrInstructor,
  async (req, res) => {
    try {
      // Pagination guards (cap limit to prevent huge payloads)
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
      const page = Math.max(1, Number(req.query.page) || 1);
      const skip = (page - 1) * limit;

      // Least-privilege selection (avoid PII like phone; avoid roster/links)
      const userSelect = "firstName lastName email privilege enrolledClasses creationDate";
      const classSelect = "level ageGroup instructor schedule isEnrollmentOpen image";

      // Run data fetch + total count in parallel for better latency
      const [items, total] = await Promise.all([
        User.find({ privilege: "student" })
          .select(userSelect)
          .skip(skip)
          .limit(limit)
          // Populate enrolled classes with safe fields only (no roster, no Classroom link)
          .populate({ path: "enrolledClasses", select: classSelect })
          .lean(), // return plain objects (faster, smaller)
        User.countDocuments({ privilege: "student" }),
      ]);

      res.json({ items, total, page, limit });
    } catch (err) {
      console.error("students-with-classes error:", err);
      res.status(500).json({ message: "Failed to fetch students" });
    }
  }
);

export default router;