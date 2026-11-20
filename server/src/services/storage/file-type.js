import { fileTypeFromFile } from "file-type";
import { FILE_KINDS } from "../../config/storage.js";

// Détecte le type RÉEL d'un fichier par son contenu (octets magiques).
// Retourne { kind, mime, ext } ou null si le format n'est pas autorisé.
export async function detectKind(path) {
  const detected = await fileTypeFromFile(path);
  if (!detected) return null;

  for (const [kind, def] of Object.entries(FILE_KINDS)) {
    if (def.mimes[detected.mime]) {
      return { kind, mime: detected.mime, ext: def.mimes[detected.mime] };
    }
  }
  return null;
}
