const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");
require("dotenv").config();

// ─────────────────────────────────────────
// Z-API WhatsApp
// ─────────────────────────────────────────
const ZAPI_URL = "https://api.z-api.io/instances/3F1E745A850D0276ADEF06ABA24BC57F/token/696E4BA57AAF7EEAE852157D/send-text";
const WHATSAPP_VENDAS = process.env.WHATSAPP_VENDAS || "5511925756805";

async function enviarWhatsApp(mensagem) {
  try {
    const response = await fetch(ZAPI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: WHATSAPP_VENDAS, message: mensagem }),
    });
    const data = await response.json();
    console.log("WhatsApp enviado:", data);
  } catch (err) {
    console.error("Erro ao enviar WhatsApp:", err.message);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────
// Google Calendar Auth (Service Account)
// ─────────────────────────────────────────
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/calendar"],
});

const calendar = google.calendar({ version: "v3", auth });
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

// ─────────────────────────────────────────
// Nodemailer (Gmail)
// ─────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASS,
  },
});

// ─────────────────────────────────────────
// GET /disponibilidade?data=YYYY-MM-DD
// ─────────────────────────────────────────
app.get("/disponibilidade", async (req, res) => {
  try {
    const { data } = req.query;
    if (!data) return res.status(400).json({ error: "Parâmetro 'data' obrigatório (YYYY-MM-DD)" });

    const timeMin = new Date(`${data}T08:00:00-03:00`).toISOString();
    const timeMax = new Date(`${data}T18:00:00-03:00`).toISOString();

    const eventos = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });

    const ocupados = (eventos.data.items || []).map((e) => ({
      inicio: e.start.dateTime,
      fim: e.end.dateTime,
    }));

    const slots = [];
    for (let h = 8; h <= 17; h++) {
      const inicio = new Date(`${data}T${String(h).padStart(2, "0")}:00:00-03:00`);
      const fim = new Date(`${data}T${String(h + 1).padStart(2, "0")}:00:00-03:00`);

      const livre = !ocupados.some((o) => {
        const oInicio = new Date(o.inicio);
        const oFim = new Date(o.fim);
        return inicio < oFim && fim > oInicio;
      });

      if (livre) {
        slots.push({
          label: `${String(h).padStart(2, "0")}:00 - ${String(h + 1).padStart(2, "0")}:00`,
          inicio: inicio.toISOString(),
          fim: fim.toISOString(),
        });
      }
    }

    res.json({ data, slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao consultar agenda", detalhes: err.message });
  }
});

// ─────────────────────────────────────────
// POST /agendar
// ─────────────────────────────────────────
app.post("/agendar", async (req, res) => {
  try {
    const { nome, condominio, cargo, telefone, email, cidade, inicio, fim, produto } = req.body;

    if (!nome || !email || !inicio || !fim) {
      return res.status(400).json({ error: "Campos obrigatórios: nome, email, inicio, fim" });
    }

    // 1. Google Calendar
    const evento = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `Visita Tecnica - ${nome} | ${condominio || ""}`,
        description: `Cliente: ${nome}\nCondominio: ${condominio || "N/A"}\nCargo: ${cargo || "N/A"}\nTelefone: ${telefone || "N/A"}\nEmail: ${email}\nCidade: ${cidade || "N/A"}\nInteresse: ${produto || "Automacao predial geral"}`,
        start: { dateTime: inicio, timeZone: "America/Sao_Paulo" },
        end: { dateTime: fim, timeZone: "America/Sao_Paulo" },
        attendees: [{ email }],
        reminders: {
          useDefault: false,
          overrides: [
            { method: "email", minutes: 24 * 60 },
            { method: "popup", minutes: 60 },
          ],
        },
      },
    });

    const dataFormatada = new Date(inicio).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long", day: "2-digit", month: "long",
      year: "numeric", hour: "2-digit", minute: "2-digit",
    });

    // 2. Email para o cliente
    await transporter.sendMail({
      from: `"Alex - 3N Technology" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Visita agendada - 3N Technology | ${dataFormatada}`,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:auto;background:#f9f9f9;border-radius:12px;overflow:hidden"><div style="background:linear-gradient(135deg,#00C896,#0077FF);padding:32px;text-align:center"><h1 style="color:white;margin:0;font-size:24px">3N Technology</h1><p style="color:rgba(255,255,255,0.85);margin:8px 0 0">Automacao Predial Inteligente</p></div><div style="padding:32px"><h2 style="color:#1a1a2e;margin-top:0">Ola, ${nome}!</h2><p style="color:#444;line-height:1.7">Sua visita tecnica foi confirmada. Nossa equipe esta ansiosa para apresentar nossas solucoes para o <strong>${condominio || "seu condominio"}</strong>.</p><div style="background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:20px;margin:24px 0"><p style="margin:0 0 8px;color:#888;font-size:13px">DETALHES DA VISITA</p><p style="margin:0;font-size:18px;font-weight:700;color:#00C896">Data: ${dataFormatada}</p><p style="margin:8px 0 0;color:#666">Local: ${cidade || "A confirmar"}</p></div><p style="color:#444;line-height:1.7">Em breve nossa equipe entrara em contato para confirmar o endereco e os detalhes finais.</p></div><div style="background:#f0f0f0;padding:16px;text-align:center"><p style="color:#888;font-size:12px;margin:0">3N Technology | www.3ntechnology.com.br</p></div></div>`,
    });

    // 3. Email para vendas
    await transporter.sendMail({
      from: `"Sistema 3N" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_VENDAS,
      subject: `Nova visita agendada - ${nome} | ${dataFormatada}`,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:auto"><h2 style="color:#0077FF">Nova Visita Tecnica Agendada</h2><p><b>Cliente:</b> ${nome}</p><p><b>Condominio:</b> ${condominio || "N/A"}</p><p><b>Cargo:</b> ${cargo || "N/A"}</p><p><b>Telefone:</b> ${telefone || "N/A"}</p><p><b>Email:</b> ${email}</p><p><b>Cidade:</b> ${cidade || "N/A"}</p><p><b>Data/Hora:</b> ${dataFormatada}</p><p><b>Interesse:</b> ${produto || "Geral"}</p></div>`,
    });

    // 4. WhatsApp para vendas
    await enviarWhatsApp(`*Nova Visita Agendada - 3N Technology*\n\n*Cliente:* ${nome}\n*Condominio:* ${condominio || "N/A"}\n*Cargo:* ${cargo || "N/A"}\n*Telefone:* ${telefone || "N/A"}\n*Email:* ${email}\n*Cidade:* ${cidade || "N/A"}\n*Data/Hora:* ${dataFormatada}\n*Interesse:* ${produto || "Automacao geral"}\n\nEvento criado no Google Calendar.`);

    res.json({
      sucesso: true,
      eventoId: evento.data.id,
      link: evento.data.htmlLink,
      mensagem: `Visita agendada para ${dataFormatada}`,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao agendar", detalhes: err.message });
  }
});
app.post("/chat", async (req, res) => {
  try {
    const { messages, system } = req.body;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1000,
        system,
        messages,
      }),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Erro no chat", detalhes: err.message });
  }
});
app.get("/", (req, res) => res.json({ status: "3N API online" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`3N API rodando na porta ${PORT}`));
