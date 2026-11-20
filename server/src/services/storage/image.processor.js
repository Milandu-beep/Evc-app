import sharp from "sharp";
import { readFile } from "node:fs/promises";

// Pas de cache de fichiers ouverts : sous Windows, il empêche de supprimer les fichiers temporaires.
sharp.cache(false);

// Applique l'orientation EXIF puis supprime toutes les métadonnées (position GPS, appareil…).
// sharp n'écrit aucune métadonnée par défaut. Le fichier est réécrit sur place.
// L'image est lue en mémoire (10 Mo maximum, vérifié avant) : lire par chemin verrouille
// le fichier sous Windows et empêche de le réécrire.
// Retourne { width, height } du résultat.
export async function processImage(path, mime) {
  const input = await readFile(path);
  const pipeline = sharp(input, { failOn: "error" }).rotate();

  if (mime === "image/jpeg") pipeline.jpeg({ quality: 92, mozjpeg: true });
  else if (mime === "image/png") pipeline.png({ compressionLevel: 9 });
  else if (mime === "image/webp") pipeline.webp({ quality: 92 });

  const info = await pipeline.toFile(path);
  return { width: info.width, height: info.height };
}
