// server.js — version propre & stable pour Railway

require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// CORS pour pouvoir appeler l’API depuis le front
app.use(cors());

// ----- Upload temporaire des images -----
const upload = multer({ dest: "uploads/" });

// ----- Client OpenAI -----
if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY n'est pas défini dans les variables d'environnement !");
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ----- Helper : fichier → base64 -----
function fileToBase64(filePath) {
  const data = fs.readFileSync(filePath);
  return data.toString("base64");
}

// ----- Route santé pour Railway -----
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// ----- Route principale : sert la page HTML -----
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ----- Route d’analyse d’image -----
app.post("/analyze", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Aucune image reçue." });
  }

  const imagePath = req.file.path;

  try {
    const imageBase64 = fileToBase64(imagePath);

    // Prompt d’inventaire
    const prompt = `
Tu es un expert en inventaire visuel pour les commerces.
Tu reçois une photo d'un rayon / tablette de magasin (vue globale).

Objectif :
- Identifier les produits principaux visibles.
- Pour chaque type de produit, retourner :
  - "label" : nom / description du produit (en français simple).
  - "brand" : marque si visible (sinon chaîne vide).
  - "estimated_quantity" : estimation du nombre d'unités visibles (entier, même si approximatif).
  - "position" : position sur la tablette (ex: "haut gauche", "milieu centre", "bas droite").
  - "confidence" : niveau de confiance entre 0 et 1 (ex: 0.82).

Réponds STRICTEMENT au format JSON suivant :
{
  "inventory": [
    {
      "label": "...",
      "brand": "...",
      "estimated_quantity": 0,
      "position": "...",
      "confidence": 0.0
    }
  ]
}
Aucun texte en dehors du JSON.
    `.trim();

    // Appel OpenAI Responses API
    // Appel OpenAI (chat + image)
    const openaiResponse = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Tu es un expert en inventaire visuel pour les commerces."
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${imageBase64}`
            }
          ]
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "inventory_schema",
          schema: {
            type: "object",
            properties: {
              inventory: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    brand: { type: "string" },
                    estimated_quantity: { type: "integer" },
                    position: { type: "string" },
                    confidence: { type: "number" }
                  },
                  required: [
                    "label",
                    "brand",
                    "estimated_quantity",
                    "position",
                    "confidence"
                  ]
                }
              }
            }
          }
        }
      }
    });

    // Le JSON retourné par OpenAI
    const parsed = JSON.parse(openaiResponse.choices[0].message.content);

    // Nettoyage du fichier temporaire
    fs.unlink(imagePath, () => { });

    // Réponse au frontend
    return res.json(parsed);

  } catch (err) {
    console.error("Erreur API :", err);
    fs.unlink(imagePath, () => { });
    return res.status(500).json({ error: "Erreur interne API" });
  }
});

// ----- Lancement du serveur -----
app.listen(PORT, () => {
  console.log("GasAI Inventory API déployée !");
  console.log(`🚀 GasAI Inventory API active sur port Railway : ${PORT}`);
});
