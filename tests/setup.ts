// Runs before every test file. The app creates its data folder as soon as
// config.ts is imported, so point it at a fresh temporary folder first: tests
// must never touch the real data/ folder.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.OPENCREWBOT_DATA_DIR = mkdtempSync(join(tmpdir(), "opencrewbot-test-"));
