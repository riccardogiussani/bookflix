async function requestAdmin(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Operazione non riuscita.');
  return result;
}

function api(path, body) {
  return requestAdmin(path, body === undefined ? undefined : {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Bookflix-Local': '1'},
    body: JSON.stringify(body),
  });
}

function postImage(path, image) {
  return requestAdmin(path, {
    method: 'POST',
    headers: {'X-Bookflix-Local': '1', 'Content-Type': image.type || 'application/octet-stream'},
    body: image,
  });
}

async function readCoverMetadata(photo) {
  // Convert all supported cover formats to JPEG for llama-server and bound the image size.
  const bitmap = await createImageBitmap(photo);
  const canvas = document.createElement('canvas');
  let jpeg;
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', {alpha: false});
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
    if (!jpeg) throw Error('Impossibile preparare l’immagine per Bonsai.');
  } finally {
    bitmap.close();
  }
  return postImage('/admin/cover-metadata', jpeg);
}
