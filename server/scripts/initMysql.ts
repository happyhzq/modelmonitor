import { loadEnv } from "../env";
import { ensureMysqlSchema } from "../db";

loadEnv();

await ensureMysqlSchema();
console.log("MySQL database and tables are ready.");
