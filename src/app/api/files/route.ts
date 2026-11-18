import { connection } from "next/server";
import { handle } from "@/lib/server/http";
import { FileAccessError, listFiles, saveUpload } from "@/lib/server/files";
import { InputError } from "@/lib/server/service";

/** Everything in the shared Files folder. */
export async function GET() {
  await connection();
  return handle(async () => ({ files: listFiles() }));
}

/** Upload one file (form field "file") into Files/uploads. CSV, Markdown, text and JSON only, up to 5 MB. */
export async function POST(request: Request) {
  return handle(async () => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new InputError('Send the file as form field "file".');
    try {
      return { path: saveUpload(file.name, Buffer.from(await file.arrayBuffer())) };
    } catch (error) {
      if (error instanceof FileAccessError) throw new InputError(error.message);
      throw error;
    }
  });
}
