async function get(url) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    console.log('URL:', url, '→ status', res.status, '(' + text.length + ' chars)');
    const stripped = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    console.log(stripped.slice(0, 4000));
  } catch (e) {
    console.log('ERROR', e.message);
  }
}

await get('https://vercel.com/docs/two-factor-authentication');
