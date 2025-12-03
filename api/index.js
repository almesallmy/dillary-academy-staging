// api/index.js
// Express entrypoint for the API.
// Goals:
//  - Serverless-safe on Vercel (no unconditional app.listen())
//  - Reuse a single Mongoose connection per instance (dbConnect() is memoized)
//  - Keep endpoints and routers exactly as before

import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import mongoSanitize from "express-mongo-sanitize";

// Utils
import { validateInput } from "../src/utils/backend/validate-utils.js";

// Schemas (used by a few legacy endpoints below)
import User from "./schemas/User.js";
import Class from "./schemas/Class.js";

// Routers
import translationRoutes from "./routes/translation-routes.js";
import emailRoutes from "./routes/email-routes.js";
import userRoutes from "./routes/user-routes.js";
import levelRoutes from "./routes/level-routes.js";
import classRoutes from "./routes/class-routes.js";

// Memoized DB connection (must export a function that reuses an existing conn)
import { dbConnect } from "./db.js";

// Security middleware (Helmet + CSP), centralized in /middleware
import security from "./middleware/security.js";

// Rate limiting
import { apiLimiter, burstLimiter } from "./middleware/rate-limit.js";

const app = express();

// --- Global middleware (order matters) ---------------------------------------
app.disable("x-powered-by");

// Ensure correct client IPs behind Vercel/CF for rate limiting & logs
app.set("trust proxy", 1);

// Security headers (CSP, HSTS, etc.)
app.use(security);

// CORS: allow same-origin and an allowlist from env
// Set ALLOWED_ORIGINS as a comma-separated list in Vercel project settings if needed.
const allowlist = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin (no Origin header) & explicit allowlist
      if (!origin || allowlist.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"), false);
    },
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "Accept",
      "Content-Type",
      "Authorization",
      "X-Requested-With"
    ],
  })
);

// Body parsing & basic injection protection
app.use(express.json({ limit: "100kb" }));
app.use(mongoSanitize());

// Rate limit early (before DB work)
app.use("/api", apiLimiter);
// Stricter limiter for sensitive endpoints
app.use("/api/sign-up", burstLimiter);

// Ensure DB is connected before any route runs.
// dbConnect() should be memoized so warm invocations are a fast no-op.
app.use(async (req, res, next) => {
  try {
    await dbConnect();
    next();
  } catch (err) {
    console.error("DB connect failed:", err);
    res.status(500).json({ message: "Database connection failed" });
  }
});

// Attach one error listener per process to surface driver-level issues.
if (mongoose.connection.listenerCount("error") === 0) {
  mongoose.connection.on("error", (err) => {
    console.error("MongoDB connection error:", err);
  });
}

// --- Mount feature routers ----------------------------------------------------
app.use("/api/locales", translationRoutes);
app.use("/api", emailRoutes);
app.use("/api", userRoutes);
app.use("/api/levels", levelRoutes);
app.use("/api/classes", classRoutes);

// --- Health check (simple visibility for uptime checks) ----------------------
app.get("/api/health", (_req, res) => {
  // readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  res.json({ ok: true, db: mongoose.connection.readyState });
});

// ------------------ Legacy endpoints kept as-is ------------------------------

// Get All Classes (with simple filter support)
app.get("/api/all-classes", async (req, res) => {
  try {
    if ("level" in req.query) {
      req.query.level = Number(req.query.level);
    }
    const allowedFields = ["level", "instructor", "ageGroup"];
    const filters = validateInput(req.query, allowedFields);

    const data = await Class.find(filters);
    res.json(data);
  } catch (err) {
    res.status(500).send(err);
  }
});

// Enroll in a class
app.put("/api/users/:id/enroll", async (req, res) => {
  const { classId } = req.body;
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  try {
    const user = await User.findById(id);
    if (user.enrolledClasses.includes(classId)) {
      return res.status(400).json({ message: "Already enrolled in this class" });
    }

    const cls = await Class.findById(classId);
    if (!cls) return res.status(404).json({ message: "Class not found" });
    if (!cls.isEnrollmentOpen) {
      return res.status(403).json({ message: "Enrollment is currently closed for this class." });
    }

    await User.findByIdAndUpdate(id, { $addToSet: { enrolledClasses: classId } });
    await Class.findByIdAndUpdate(classId, { $addToSet: { roster: id } });

    res.status(201).json({ message: "Enrolled successfully!" });
  } catch (err) {
    console.error("Error enrolling into class:", err);
    res.status(500).json({ message: "Error enrolling into class" });
  }
});

// Unenroll from a class
app.put("/api/users/:id/unenroll", async (req, res) => {
  const { classId } = req.body;
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  try {
    const user = await User.findById(id);
    if (!user.enrolledClasses.includes(classId)) {
      return res.status(400).json({ message: "Not enrolled in this class" });
    }

    await User.findByIdAndUpdate(id, { $pull: { enrolledClasses: classId } });
    await Class.findByIdAndUpdate(classId, { $pull: { roster: id } });

    res.status(201).json({ message: "Successfully unenrolled" });
  } catch (err) {
    res.status(500).json({ message: "Error unenrolling into class" });
  }
});

// Students export (kept as-is functionally)
app.get("/api/students-export", async (_req, res) => {
  try {
    const students = await User.find({ privilege: "student" });
    const classes = await Class.find();
    const classMap = new Map(classes.map((c) => [c._id.toString(), c]));

    const formatTime = (hours, minutes) => {
      const period = hours >= 12 ? "pm" : "am";
      const hour12 = hours % 12 || 12;
      return `${hour12}:${minutes.toString().padStart(2, "0")}${period}`;
    };

    const formattedStudents = [];

    for (const student of students) {
      const enrolled = (student.enrolledClasses || [])
        .map((classId) => {
          const classInfo = classMap.get(classId.toString());
          if (!classInfo || !Array.isArray(classInfo.schedule)) return null;

          const scheduleEST = classInfo.schedule
            .map((s) => `${s.day} ${s.startTime}-${s.endTime}`)
            .join("\n");

          const scheduleIstanbul = classInfo.schedule
            .map((s) => {
              const [startHour, startMin] = s.startTime.split(":").map(Number);
              const [endHour, endMin] = s.endTime.split(":").map(Number);

              const estStart = new Date();
              const estEnd = new Date();
              estStart.setHours(startHour, startMin || 0);
              estEnd.setHours(endHour, endMin || 0);

              const istStart = new Date(estStart.getTime() + 7 * 60 * 60 * 1000);
              const istEnd = new Date(estEnd.getTime() + 7 * 60 * 60 * 1000);

              return `${s.day} ${formatTime(istStart.getHours(), istStart.getMinutes())}-${formatTime(
                istEnd.getHours(),
                istEnd.getMinutes()
              )}`;
            })
            .join("\n");

          return {
            level: classInfo.level,
            ageGroup: classInfo.ageGroup,
            instructor: classInfo.instructor,
            link: classInfo.link,
            scheduleEST,
            scheduleIstanbul
          };
        })
        .filter(Boolean);

      if (enrolled.length === 0) {
        formattedStudents.push({
          firstName: student.firstName,
          lastName: student.lastName,
          email: student.email,
          creationDate: student.creationDate.toISOString().split("T")[0],
          level: "",
          ageGroup: "",
          instructor: "",
          link: "",
          scheduleEST: "",
          scheduleIstanbul: ""
        });
      } else {
        for (const classInfo of enrolled) {
          formattedStudents.push({
            firstName: student.firstName,
            lastName: student.lastName,
            email: student.email,
            creationDate: student.creationDate.toISOString().split("T")[0],
            ...classInfo
          });
        }
      }
    }

    res.json({ student_data: formattedStudents });
  } catch (err) {
    console.error("Error exporting students:", err.stack || err);
    res.status(500).json({ message: "Error exporting students" });
  }
});

// --- Local dev only: start HTTP server ---------------------------------------
// Vercel (serverless) will NOT use this. It requires a default export.
if (process.env.VERCEL !== "1" && process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`API listening locally on http://localhost:${PORT}`);
  });
}

// --- Required for Vercel serverless ------------------------------------------
export default app;