import express, { Request, Response, NextFunction } from "express";
import mongoose, { Document, Schema, Model } from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import NodeCache from "node-cache";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { cleanEnv, str, port } from "envalid";
import winston from "winston";

dotenv.config();

// Validate environment variables
cleanEnv(process.env, {
  PORT: port({ default: 8000 }),
  MONGO_URI: str(),
});

const visitCache = new NodeCache({ stdTTL: 600, checkperiod: 120 }); // Cache for 10 minutes
const app = express();
const PORT: number = Number(process.env.PORT) || 8000;
const MONGO_URI: string = process.env.MONGO_URI!;

// Configure Logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "server.log" }),
  ],
});

// MongoDB Schema and Model
interface IVisit extends Document {
  count: number;
}

const visitSchema = new Schema<IVisit>({
  count: { type: Number, default: 0 },
});

const Visit: Model<IVisit> = mongoose.model("Visit", visitSchema);

// Connect to MongoDB
mongoose
  .connect(MONGO_URI)
  .then(() => logger.info("Connected to MongoDB"))
  .catch((err) => logger.error("Error connecting to MongoDB:", err));

// MongoDB connection events
mongoose.connection.on("connected", () => logger.info("MongoDB connected"));
mongoose.connection.on("error", (err) =>
  logger.error("MongoDB connection error:", err)
);
mongoose.connection.on("disconnected", () =>
  logger.info("MongoDB disconnected")
);

// Initialize database
const initializeDatabase = async (): Promise<void> => {
  try {
    const visit = await Visit.findOne();
    if (!visit) {
      await Visit.create({ count: 0 });
      logger.info("Initialized visit count in database.");
    }
  } catch (error) {
    logger.error("Error initializing database:", error);
  }
};
initializeDatabase();

// Middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use(limiter);
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(helmet());

// Helper for async route handling
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Routes
app.get("/", (req: Request, res: Response) => {
  res.send("Server is running!");
});

app.get("/health", (req: Request, res: Response) => {
  res.send({ status: "OK", uptime: process.uptime() });
});

app.get("/readiness", async (req: Request, res: Response) => {
  const mongoState = mongoose.connection.readyState;
  if (mongoState === 1) {
    res.status(200).send({ status: "Ready" });
  } else {
    res.status(500).send({ status: "Not Ready" });
  }
});

// Helper to update visit count
const updateVisitCount = async (): Promise<number> => {
  let visitCount = visitCache.get<number>("visitCount");
  if (!visitCount) {
    let visit = await Visit.findOne();
    if (!visit) {
      visit = new Visit({ count: 1 });
    } else {
      visit.count += 1;
    }
    await visit.save();
    visitCache.set("visitCount", visit.count);
    visitCount = visit.count;
  }
  return visitCount;
};

// Endpoint to get and update visit count
app.get(
  "/api/visit",
  asyncHandler(async (req: Request, res: Response) => {
    const visitCount = await updateVisitCount();
    res.json({ visitCount });
  })
);

// Centralized error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction): void => {
  logger.error(`[${new Date().toISOString()}] ${err.stack}`);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Shutting down...");
  await mongoose.connection.close();
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Start server
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});
