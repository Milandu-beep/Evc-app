import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

// SHA-256 hexadécimal d'un fichier, lu en flux (pas de chargement complet en mémoire).
export const sha256File = (path) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
