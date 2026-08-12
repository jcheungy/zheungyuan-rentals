import pg from "pg";
const { Pool } = pg;

const globalForDb = globalThis;
export const pool =
  globalForDb.__zheungyuanPool ||
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
  });

if (process.env.NODE_ENV !== "production") globalForDb.__zheungyuanPool = pool;
