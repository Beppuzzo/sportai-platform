export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { query } = req.query;
  const UNSPLASH_KEY = "GthMipPPgDXBhWaAOZYCET7XRIKMvbhyMeZdtgDrCQs";

  try {
    const response = await fetch(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query || "sport italy")}&orientation=landscape&client_id=${UNSPLASH_KEY}`
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: "Unsplash error" });
    }

    const data = await response.json();
    return res.status(200).json({ url: data.urls?.regular || null });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
