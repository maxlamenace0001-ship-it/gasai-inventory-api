require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const OpenAI = require("openai");
const cors = require("cors");
const path = require("path");


const app = express();
const port = process.env.PORT || 3002;

app.use(cors());

// Config upload (stockage temporaire)
const upload = multer({ dest: "uploads/" });

// OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Convertir une image en base64
function toBase64(path) {
  const data = fs.readFileSync(path);
  return data.toString("base64");
}

// Route principale : renvoie la page web
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Route d'analyse d'image
app.post("/analyze", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Aucune image reçue." });
  }

  try {
    const imageBase64 = toBase64(req.file.path);

    // Prompt pour l'inventaire
    const prompt = `
Tu es un expert en inventaire visuel pour des commerces.
Analyse l'image et renvoie un JSON structuré :

{
  "inventory": [
    {
      "label": "nom du produit",
      "brand": "marque ou null",
      "estimated_quantity": nombre entier,
      "confidence": nombre entre 0 et 1,
      "position": "haut/milieu/bas ou null"
    }
  ]
}

Respecte strictement ce format JSON.
`;

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyse ce rayon."
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageBase64}`
              }
            }
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = response.choices[0].message.content;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { error: "Réponse non parsable", raw };
    }

    // 🔽🔽🔽 AJOUT : génération automatique du CSV 🔽🔽🔽
    try {
      const inventory = parsed.inventory || [];

      // Lignes du CSV
      const csvLines = ["label,brand,estimated_quantity,position,confidence"];

      inventory.forEach((item) => {
        const label = (item.label || "").replace(/,/g, " ");
        const brand = (item.brand || "").replace(/,/g, " ");
        const qty = item.estimated_quantity ?? "";
        const pos = (item.position || "").replace(/,/g, " ");
        const conf = item.confidence ?? "";

        csvLines.push(`${label},${brand},${qty},${pos},${conf}`);
      });

      const csvContent = csvLines.join("\n");

      // Dossier d'export
      const exportDir = "exports";
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir);
      }

      // Nom de fichier avec timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const csvPath = `${exportDir}/inventory_${timestamp}.csv`;

      fs.writeFileSync(csvPath, csvContent, "utf8");

      // On ajoute le chemin du CSV dans la réponse JSON
      parsed.csv_path = csvPath;
    } catch (e) {
      console.error("Erreur lors de la génération du CSV:", e);
    }
    // 🔼🔼🔼 FIN DE L’AJOUT CSV 🔼🔼🔼

    fs.unlink(req.file.path, () => { }); // Nettoyage image temporaire

    return res.json(parsed);
  } catch (err) {
    console.error("Erreur API :", err);
    fs.unlink(req.file.path, () => { });
    return res.status(500).json({ error: "Erreur interne API" });
  }
});

app.listen(port, () => {
  console.log("GasAI Inventory API déployée !");
  console.log(`🚀 GasAI Inventory API active sur http://localhost:${port}`);
});
