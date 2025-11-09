import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import User from "../schemas/User.js";
import Class from "../schemas/Class.js";
import { clerkClient } from "@clerk/express";
import { validateInput } from "../../src/utils/backend/validate-utils.js";

const router = express.Router();

// Sign up
router.post('/sign-up', async (req, res) => {
  try {
    const { firstName, lastName, email, whatsapp, clerkId } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({ message: 'Email already exists' });
    }

    // Create new user with separate first/last name fields
    const newUser = new User({
      firstName,
      lastName,
      email,
      whatsapp,
      clerkId
    });

    await newUser.save();
    res.status(201).json(newUser);

  } catch (error) {
    console.error('Failed to sign up:', error);
    res.status(500).json({ message: 'Failed to sign up' });
  }
})

// Get Users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find();
    return res.status(200).json(users);
  } catch (err) {
    res.status(500).send(err);
  }
})


// Get User
router.get('/user', async (req, res) => {
  const allowedFields = ['_id', 'email', 'whatsapp']
  const filters = validateInput(req.query, allowedFields)

  if (Object.keys(filters).length === 0) {
    res.status(404).send('Error: user not found', err);
  }

  try {
    const user = await User.findOne(filters);
    res.status(200).json(user);
  } catch (err) {
    res.status(500).send(err);
  }
})

// Edit user
router.put('/user/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const originalUser = await User.findById(id);

    if (!originalUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // add new email address to Clerk and delete old one
    if (originalUser.email !== updates.email) {
      await clerkClient.emailAddresses.createEmailAddress({
        userId: originalUser.clerkId,
        emailAddress: updates.email,
        verified: true,
        primary: true
      });

      await clerkClient.users
        .getUser(originalUser.clerkId)
        .then(async (data) => {
          const userEmailData = data.emailAddresses.find(
            (emailData) => emailData.emailAddress === originalUser.email
          );
          return userEmailData.id;
        })
        .then(
          async (userEmailId) => await clerkClient.emailAddresses.deleteEmailAddress(userEmailId)
        )
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error('Failed to update user:', error);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

// Delete User
router.delete('/user/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const deletedUser = await User.findOne({ _id: id });
    if (!deletedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // remove student from enrolled classes' roster
    await Promise.all(
      deletedUser.enrolledClasses.map(async (classId) => {
        try {
          const classDoc = await Class.findById(classId);

          if (classDoc) {
            await Class.findByIdAndUpdate(classId, { $pull: { roster: id } });
          } else {
            await Conversation.findByIdAndUpdate(classId, { $pull: { roster: id } });
          }
        } catch (err) {
          throw err;
        }
      })
    );

    // delete user
    await clerkClient.users.deleteUser(deletedUser.clerkId);
    await User.findByIdAndDelete(id);

    res.status(204).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Failed to delete user:', error);
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

// Get student's classes full details
router.get('/students-classes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const classDetails = await User.findById(id)
      .select('enrolledClasses')
      .populate('enrolledClasses')
    res.json(classDetails.enrolledClasses); // return array of class objects
  } catch (err) {
    res.status(500).send(err);
  }
})

// GET /api/students-with-classes?limit=100&page=1
// Purpose: Replace N+1 per-student fetches with ONE paginated response.
// NOTE: Temporarily public so the page can load; we’ll add Clerk auth once login cleanup is done.
router.get('/students-with-classes', async (req, res) => {
  try {
    // Pagination guards (cap limit to prevent huge payloads)
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
    const page  = Math.max(1, Number(req.query.page) || 1);
    const skip  = (page - 1) * limit;

    // Least-privilege field selection (avoid PII like phone; avoid roster/links)
    const userSelect  = 'firstName lastName email privilege enrolledClasses creationDate';
    const classSelect = 'level ageGroup instructor schedule isEnrollmentOpen image';

    // Run data fetch + total count in parallel for better latency
    const [items, total] = await Promise.all([
      User.find({ privilege: 'student' })
        .select(userSelect)
        .skip(skip)
        .limit(limit)
        // Populate enrolled classes with safe fields only (no roster, no Classroom link)
        .populate({ path: 'enrolledClasses', select: classSelect })
        .lean(), // return plain objects (faster, smaller)
      User.countDocuments({ privilege: 'student' })
    ]);

    res.json({ items, total, page, limit });
  } catch (err) {
    console.error('students-with-classes error:', err);
    res.status(500).json({ message: 'Failed to fetch students' });
  }
});

export default router;
