import "dotenv/config";
import { cleanEnv, str } from "envalid";

export const envalid = cleanEnv(process.env, {
  DISCORD_TOKEN: str(),
});
