import multer from "multer";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MAX_UPLOAD_BYTES, UPLOAD_TMP_DIR } from "../config/storage.js";

const tmpDir = fileURLToPath(UPLOAD_TMP_DIR);
mkdirSync(tmpDir, { recursive: true });

// Réception sur disque (pas en mémoire : les vidéos peuvent atteindre 100 Mo) avec un nom
// aléatoire : le nom envoyé par le client ne sert jamais de chemin. Le service supprime
// le fichier temporaire dans tous les cas. La limite par type est appliquée ensuite,
// une fois le type réel connu.
const upload = multer({
  storage: multer.diskStorage({
    destination: tmpDir,
    filename: (req, file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

export default upload;
