import { Database } from 'bun:sqlite';

const DATABASE_PATH = process.env.FACILITY_DB_PATH?.trim() || 'facility.sqlite';
export const db = new Database(DATABASE_PATH, { create: true });
