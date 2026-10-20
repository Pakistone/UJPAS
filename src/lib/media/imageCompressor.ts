/**
 * PORTUS — Utilitaire de compression d'image sur `<canvas>` (~200 Ko max)
 *
 * Conçu pour les smartphones Android 2 Go RAM sur le corridor de Vridi :
 * - Redimensionne la capture d'écran ou photo Mobile Money (max 1024px sur le grand côté)
 * - Ajuste itérativement la qualité JPEG pour garantir un poids <= ~200 Ko
 * - Libère immédiatement l'URL objet (`URL.revokeObjectURL`) et le contexte `<canvas>`
 */

export interface CompressedScreenshotResult {
  dataUrl: string;
  sizeKb: number;
  width: number;
  height: number;
  qualityUsed: number;
}

export async function compressImageFileToCanvas200Kb(
  file: File,
  targetMaxKb = 200
): Promise<CompressedScreenshotResult> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error('Impossible de décoder la capture Mobile Money.'));
      element.src = objectUrl;
    });

    const maxDimension = 1024;
    let width = img.naturalWidth || img.width || 800;
    let height = img.naturalHeight || img.height || 600;

    if (width > maxDimension || height > maxDimension) {
      if (width >= height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Contexte Canvas 2D indisponible sur ce terminal.');
    }

    ctx.fillStyle = '#090D16';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    // Recherche itérative de la qualité JPEG optimale pour rester <= ~200 Ko
    let quality = 0.82;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    let sizeKb = Math.round(((dataUrl.length * 3) / 4 / 1024) * 10) / 10;

    while (sizeKb > targetMaxKb && quality > 0.28) {
      quality = Math.round((quality - 0.12) * 100) / 100;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
      sizeKb = Math.round(((dataUrl.length * 3) / 4 / 1024) * 10) / 10;
    }

    // Nettoyage explicite du canvas en RAM (anti-OOM Android 2 Go)
    canvas.width = 0;
    canvas.height = 0;

    return {
      dataUrl,
      sizeKb,
      width,
      height,
      qualityUsed: quality,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Génère sur `<canvas>` une capture de preuve Mobile Money horodatée (~140 Ko)
 * pour permettre le test immédiat en environnement sans fichier externe si souhaité
 */
export function generateSyntheticMobileMoneyReceiptCanvas(params: {
  operator: string;
  reference: string;
  amountFcfa: number;
  truckPlate: string;
  ticketNumber: string;
}): CompressedScreenshotResult {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D non supporté.');
  }

  // Fond texturé haute densité afin de produire un JPEG réaliste (~120–185 Ko)
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, 720, 900);

  for (let y = 0; y < 900; y += 6) {
    for (let x = 0; x < 720; x += 6) {
      const shade = 18 + ((x * 13 + y * 29) % 28);
      ctx.fillStyle = `rgb(${shade}, ${shade + 8}, ${shade + 18})`;
      ctx.fillRect(x, y, 5, 5);
    }
  }

  ctx.fillStyle = '#1E293B';
  ctx.fillRect(36, 36, 648, 828);
  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 4;
  ctx.strokeRect(36, 36, 648, 828);

  ctx.fillStyle = '#F59E0B';
  ctx.font = 'bold 28px monospace';
  ctx.fillText(`PREUVE MOBILE MONEY — ${params.operator}`, 68, 105);

  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 22px monospace';
  ctx.fillText(`RÉFÉRENCE : ${params.reference}`, 68, 175);
  ctx.fillText(`MONTANT   : ${params.amountFcfa} FCFA`, 68, 225);
  ctx.fillText(`TICKET    : ${params.ticketNumber}`, 68, 275);
  ctx.fillText(`CAMION    : ${params.truckPlate}`, 68, 325);
  ctx.fillText(
    `DATE      : ${new Date().toLocaleString('fr-FR')}`,
    68,
    375
  );

  ctx.fillStyle = '#10B981';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(
    "Contribution d'Assistance et de Sécurisation — UJPAS Vridi",
    68,
    450
  );

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const sizeKb = Math.round(((dataUrl.length * 3) / 4 / 1024) * 10) / 10;

  canvas.width = 0;
  canvas.height = 0;

  return {
    dataUrl,
    sizeKb,
    width: 720,
    height: 900,
    qualityUsed: 0.85,
  };
}
