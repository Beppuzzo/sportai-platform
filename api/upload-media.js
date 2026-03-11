export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { imageUrl, wpUrl, wpUser, wpPassword } = req.body;
  if (!imageUrl || !wpUrl || !wpUser || !wpPassword) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  try {
    // Step 1: Download image from Unsplash (server-side, no CORS)
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return res.status(500).json({ error: "Failed to fetch image" });

    const imgBuffer = await imgRes.arrayBuffer();
    const imgBytes = Buffer.from(imgBuffer);

    // Step 2: Upload to WordPress media library
    const creds = Buffer.from(`${wpUser}:${wpPassword}`).toString("base64");
    const wpRes = await fetch(`${wpUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${creds}`,
        "Content-Type": "image/jpeg",
        "Content-Disposition": "attachment; filename=\"copertina.jpg\"",
      },
      body: imgBytes,
    });

    if (!wpRes.ok) {
      const errData = await wpRes.json().catch(() => ({}));
      return res.status(wpRes.status).json({ error: errData.message || wpRes.status });
    }

    const wpData = await wpRes.json();
    return res.status(200).json({ id: wpData.id, url: wpData.source_url });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
