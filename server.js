/**
 * VaultSystemFx - Backend Server
 * Gestisce pagamenti PayPal e invio email automatico
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configurazione Email (Gmail SMTP)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASS
    }
});

const DOWNLOAD_LINKS = {
    standard: process.env.DOWNLOAD_LINK_STANDARD || 'https://github.com/matteosani05-blip/vaultsystemfx-backend/releases/download/v1.0/test.zip',
    student: process.env.DOWNLOAD_LINK_STUDENT || 'https://github.com/matteosani05-blip/vaultsystemfx-backend/releases/download/v1.0/test.zip'
};

const LOGO_URL = 'https://i.imgur.com/cV04HTP.png';
const SUPPORT_EMAIL = 'vaultsystemltd@gmail.com';

const orders = [];

// ═══════════════════════════════════════════════════════════════
// ROUTE: Home
// ═══════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'VaultSystemFx Backend',
        endpoints: {
            completeOrder: 'POST /api/complete-order',
            webhook: 'POST /api/paypal-webhook'
        }
    });
});

// ═══════════════════════════════════════════════════════════════
// ROUTE: Completa Ordine
// ═══════════════════════════════════════════════════════════════
app.post('/api/complete-order', async (req, res) => {
    try {
        let body = req.body;
        if (typeof body === 'string') body = JSON.parse(body);
        if (!body || Object.keys(body).length === 0) {
            return res.status(400).json({ success: false, error: 'Body vuoto' });
        }

        const { firstName, lastName, email, telegram, plan, amount, transactionId } = body;

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email mancante' });
        }

        const order = {
            id: Date.now(),
            firstName, lastName, email, telegram,
            plan, amount, transactionId,
            createdAt: new Date().toISOString()
        };
        orders.push(order);

        await sendDownloadEmail(order);
        await sendNotificationEmail(order);

        res.json({ success: true, message: 'Ordine completato e email inviata!' });

    } catch (error) {
        console.error('❌ Errore:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// ROUTE: PayPal Webhook
// ═══════════════════════════════════════════════════════════════
app.post('/api/paypal-webhook', async (req, res) => {
    try {
        const event = req.body;
        console.log('🔔 PayPal Webhook ricevuto:', event.event_type);

        if (event.event_type === 'CHECKOUT.ORDER.APPROVED' ||
            event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
            const resource = event.resource;
            console.log('💰 Pagamento confermato:', resource);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).send('Error');
    }
});

// ═══════════════════════════════════════════════════════════════
// ROUTE: Ordine Crypto
// ═══════════════════════════════════════════════════════════════
app.post('/api/crypto-order', async (req, res) => {
    try {
        const { firstName, lastName, email, telegram, plan, amount, crypto, txId } = req.body;

        const order = {
            id: Date.now(),
            firstName, lastName, email, telegram,
            plan, amount,
            paymentMethod: 'crypto',
            crypto, txId,
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        orders.push(order);

        await sendCryptoNotification(order);

        res.json({ success: true, message: 'Ordine ricevuto! Verificheremo il pagamento.' });

    } catch (error) {
        console.error('❌ Errore:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// ROUTE: Invio manuale (admin)
// ═══════════════════════════════════════════════════════════════
app.post('/api/send-manual', async (req, res) => {
    try {
        const { email, firstName, plan } = req.body;
        const adminKey = req.headers['x-admin-key'];

        if (adminKey !== process.env.ADMIN_KEY) {
            return res.status(401).json({ error: 'Non autorizzato' });
        }

        const order = { email, firstName, plan: plan || 'standard' };
        await sendDownloadEmail(order);

        res.json({ success: true, message: `Email inviata a ${email}` });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// FUNZIONI EMAIL
// ═══════════════════════════════════════════════════════════════

async function sendDownloadEmail(order) {
    const downloadLink = DOWNLOAD_LINKS[order.plan] || DOWNLOAD_LINKS.standard;

    const mailOptions = {
        from: `"VaultSystemFx" <${process.env.EMAIL_USER}>`,
        to: order.email,
        subject: '✅ Il tuo VaultSystemFx è pronto per il download',
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; background: #f0f2f5; padding: 32px 16px; }
        .wrap { max-width: 580px; margin: 0 auto; }
        .card { background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e5ea; }
        .card-header { background: #0a0d18; padding: 36px 40px 32px; text-align: center; }
        .logo-img { width: 72px; height: 72px; border-radius: 50%; margin: 0 auto 16px; display: block; }
        .brand-name { font-size: 20px; font-weight: 700; color: #ffffff; margin-bottom: 20px; letter-spacing: 0.5px; }
        .badge { display: inline-block; background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.35); border-radius: 50px; padding: 5px 14px; font-size: 11px; font-weight: 700; color: #a5b4fc; margin-bottom: 18px; letter-spacing: 0.6px; text-transform: uppercase; }
        .header-title { font-size: 26px; font-weight: 700; color: #ffffff; line-height: 1.35; margin-bottom: 12px; }
        .header-sub { font-size: 15px; color: #94a3b8; line-height: 1.65; }
        .header-sub strong { color: #c7d2fe; font-weight: 600; }
        .card-body { padding: 36px 40px; }
        .btn-wrap { text-align: center; margin-bottom: 32px; }
        .btn { display: inline-block; padding: 15px 44px; background: #6366f1; color: #ffffff !important; font-size: 15px; font-weight: 600; text-decoration: none; border-radius: 12px; }
        .btn-note { font-size: 12px; color: #94a3b8; margin-top: 10px; }
        .divider { height: 1px; background: #f1f3f6; margin: 28px 0; }
        .steps-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #94a3b8; margin-bottom: 20px; }
        .step { display: flex; align-items: flex-start; gap: 16px; padding: 16px 0; border-bottom: 1px solid #f1f3f6; }
        .step:last-child { border-bottom: none; }
        .step-num { width: 32px; height: 32px; min-width: 32px; border-radius: 10px; background: #f4f5ff; border: 1px solid #e0e1ff; text-align: center; line-height: 32px; font-size: 13px; font-weight: 700; color: #6366f1; }
        .step-content { flex: 1; }
        .step-title { font-size: 14px; font-weight: 600; color: #1e293b; display: block; margin-bottom: 4px; }
        .step-desc { font-size: 13px; color: #64748b; line-height: 1.5; }
        .code { background: #f4f5ff; color: #6366f1; padding: 1px 6px; border-radius: 4px; font-size: 12px; font-family: monospace; }
        .support { background: #f8fffe; border: 1px solid #d1fae5; border-radius: 14px; padding: 22px 24px; margin-top: 28px; text-align: center; }
        .support p { font-size: 14px; color: #065f46; font-weight: 600; margin-bottom: 6px; }
        .support a { font-size: 14px; color: #059669 !important; font-weight: 500; text-decoration: none; }
        .card-footer { background: #f8f9fb; border-top: 1px solid #e9ebef; padding: 20px 40px; text-align: center; }
        .footer-text { font-size: 12px; color: #94a3b8; line-height: 1.8; }
    </style>
</head>
<body>
    <div class="wrap">
        <div class="card">
            <div class="card-header">
                <img src="${LOGO_URL}" alt="VaultSystemFx Logo" class="logo-img" />
                <div class="brand-name">VaultSystemFx</div>
                <div class="badge">Acquisto confermato</div>
                <div class="header-title">Il tuo bot è pronto,<br>${order.firstName || 'Trader'}!</div>
                <p class="header-sub">Grazie per aver scelto <strong>VaultSystemFx</strong>.<br>Il pagamento è stato ricevuto e il download è disponibile immediatamente.</p>
            </div>

            <div class="card-body">
                <div class="btn-wrap">
                    <a href="${downloadLink}" class="btn">⬇️ &nbsp;Scarica VaultSystemFx</a>
                    <p class="btn-note">File ZIP — compatibile con Windows</p>
                </div>

                <div class="divider"></div>

                <div class="steps-label">Come iniziare</div>

                <div class="step">
                    <div class="step-num">1</div>
                    <div class="step-content">
                        <span class="step-title">Scarica e decomprimi</span>
                        <span class="step-desc">Scarica il file ZIP e estrailo in una cartella a tua scelta.</span>
                    </div>
                </div>
                <div class="step">
                    <div class="step-num">2</div>
                    <div class="step-content">
                        <span class="step-title">Avvia l'applicazione</span>
                        <span class="step-desc">Esegui <span class="code">VaultSystemFx.exe</span> come amministratore.</span>
                    </div>
                </div>
                <div class="step">
                    <div class="step-num">3</div>
                    <div class="step-content">
                        <span class="step-title">Configura MT5</span>
                        <span class="step-desc">Inserisci le credenziali del tuo conto MT5 e seleziona i simboli da tradare.</span>
                    </div>
                </div>
                <div class="step">
                    <div class="step-num">4</div>
                    <div class="step-content">
                        <span class="step-title">Avvia il bot</span>
                        <span class="step-desc">Clicca su "Avvia Bot" e lascia che VaultSystemFx lavori per te.</span>
                    </div>
                </div>

                <div class="support">
                    <p>Hai bisogno di supporto?</p>
                    <a href="mailto:${SUPPORT_EMAIL}">✉️ ${SUPPORT_EMAIL}</a>
                </div>
            </div>

            <div class="card-footer">
                <p class="footer-text">© 2025 VaultSystemFx — Tutti i diritti riservati</p>
                <p class="footer-text">Questa email è stata inviata a ${order.email}</p>
            </div>
        </div>
    </div>
</body>
</html>`
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email inviata a ${order.email}`);
}

async function sendNotificationEmail(order) {
    const notifyEmail = process.env.NOTIFY_EMAIL || process.env.EMAIL_USER;

    await transporter.sendMail({
        from: `"VaultSystemFx Bot" <${process.env.EMAIL_USER}>`,
        to: notifyEmail,
        subject: `💰 Nuovo acquisto: ${order.plan} - €${order.amount}`,
        html: `
            <h2>Nuovo ordine ricevuto!</h2>
            <ul>
                <li><strong>Cliente:</strong> ${order.firstName} ${order.lastName}</li>
                <li><strong>Email:</strong> ${order.email}</li>
                <li><strong>Telegram:</strong> ${order.telegram || 'Non fornito'}</li>
                <li><strong>Piano:</strong> ${order.plan}</li>
                <li><strong>Importo:</strong> €${order.amount}</li>
                <li><strong>Transaction ID:</strong> ${order.transactionId}</li>
                <li><strong>Data:</strong> ${order.createdAt}</li>
            </ul>`
    });
    console.log('📧 Notifica inviata');
}

async function sendCryptoNotification(order) {
    const notifyEmail = process.env.NOTIFY_EMAIL || process.env.EMAIL_USER;

    await transporter.sendMail({
        from: `"VaultSystemFx Bot" <${process.env.EMAIL_USER}>`,
        to: notifyEmail,
        subject: `🪙 CRYPTO: Verifica pagamento - ${order.email}`,
        html: `
            <h2>⚠️ Pagamento Crypto da verificare!</h2>
            <ul>
                <li><strong>Cliente:</strong> ${order.firstName} ${order.lastName}</li>
                <li><strong>Email:</strong> ${order.email}</li>
                <li><strong>Telegram:</strong> ${order.telegram || 'Non fornito'}</li>
                <li><strong>Piano:</strong> ${order.plan}</li>
                <li><strong>Crypto:</strong> ${order.crypto}</li>
                <li><strong>TxID:</strong> ${order.txId || 'Non fornito'}</li>
            </ul>
            <p>Dopo aver verificato, invia manualmente con: <code>POST /api/send-manual</code></p>`
    });
    console.log('📧 Notifica crypto inviata');
}

// ═══════════════════════════════════════════════════════════════
// AVVIO SERVER
// ═══════════════════════════════════════════════════════════════
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 Server locale su http://localhost:${PORT}`);
    });
}

module.exports = app;