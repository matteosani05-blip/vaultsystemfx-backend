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
        user: process.env.EMAIL_USER,      // La tua email Gmail
        pass: process.env.EMAIL_APP_PASS   // App Password di Gmail (non la password normale!)
    }
});

// Link per il download del bot (puoi usare Google Drive, Dropbox, ecc.)
const DOWNLOAD_LINKS = {
    standard: process.env.DOWNLOAD_LINK_STANDARD || 'https://tuolink.com/download/vaultsystemfx.zip',
    student: process.env.DOWNLOAD_LINK_STUDENT || 'https://tuolink.com/download/vaultsystemfx.zip'
};

// Database semplice in memoria (in produzione usa un vero database)
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
// ROUTE: Completa Ordine (chiamato dal frontend dopo pagamento)
// ═══════════════════════════════════════════════════════════════
app.post('/api/complete-order', async (req, res) => {
    try {
        console.log('📥 Body ricevuto:', JSON.stringify(req.body));
        console.log('📥 Content-Type:', req.headers['content-type']);

        // Parse body se arriva come stringa
        let body = req.body;
        if (typeof body === 'string') {
            body = JSON.parse(body);
        }
        if (!body || Object.keys(body).length === 0) {
            return res.status(400).json({ success: false, error: 'Body vuoto' });
        }

        const { firstName, lastName, email, telegram, plan, amount, transactionId } = body;

        // Validazione email
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email mancante' });
        }

        console.log('📦 Nuovo ordine ricevuto:', { firstName, lastName, email, plan, amount, transactionId });

        // Salva ordine
        const order = {
            id: Date.now(),
            firstName,
            lastName,
            email,
            telegram,
            plan,
            amount,
            transactionId,
            createdAt: new Date().toISOString()
        };
        orders.push(order);

        // Invia email al cliente
        await sendDownloadEmail(order);

        // Invia notifica a te (opzionale)
        await sendNotificationEmail(order);

        res.json({ success: true, message: 'Ordine completato e email inviata!' });

    } catch (error) {
        console.error('❌ Errore:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// ROUTE: PayPal Webhook (notifica automatica da PayPal)
// ═══════════════════════════════════════════════════════════════
app.post('/api/paypal-webhook', async (req, res) => {
    try {
        const event = req.body;
        console.log('🔔 PayPal Webhook ricevuto:', event.event_type);

        // Verifica che sia un pagamento completato
        if (event.event_type === 'CHECKOUT.ORDER.APPROVED' ||
            event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {

            const resource = event.resource;
            console.log('💰 Pagamento confermato:', resource);

            // Qui puoi elaborare il pagamento
            // I dati del cliente arrivano dal frontend via /api/complete-order
        }

        res.status(200).send('OK');

    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).send('Error');
    }
});

// ═══════════════════════════════════════════════════════════════
// ROUTE: Ordine Crypto (per pagamenti crypto manuali)
// ═══════════════════════════════════════════════════════════════
app.post('/api/crypto-order', async (req, res) => {
    try {
        const { firstName, lastName, email, telegram, plan, amount, crypto, txId } = req.body;

        console.log('🪙 Ordine crypto ricevuto:', { email, plan, crypto, txId });

        const order = {
            id: Date.now(),
            firstName,
            lastName,
            email,
            telegram,
            plan,
            amount,
            paymentMethod: 'crypto',
            crypto,
            txId,
            status: 'pending', // Da verificare manualmente
            createdAt: new Date().toISOString()
        };
        orders.push(order);

        // Notifica a te per verifica manuale
        await sendCryptoNotification(order);

        res.json({ success: true, message: 'Ordine ricevuto! Verificheremo il pagamento.' });

    } catch (error) {
        console.error('❌ Errore:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// ROUTE: Invia manualmente (per admin)
// ═══════════════════════════════════════════════════════════════
app.post('/api/send-manual', async (req, res) => {
    try {
        const { email, firstName, plan } = req.body;
        const adminKey = req.headers['x-admin-key'];

        // Protezione semplice
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
        subject: '🎉 Il tuo VaultSystemFx è pronto!',
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #0a0e17; color: #f4f7ff; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
        .header { text-align: center; margin-bottom: 40px; }
        .logo { font-size: 28px; font-weight: 800; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .card { background: rgba(12, 16, 24, 0.9); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 20px; padding: 40px; margin-bottom: 24px; }
        .title { font-size: 24px; font-weight: 700; margin-bottom: 16px; color: #f4f7ff; }
        .text { font-size: 16px; color: #94a3b8; line-height: 1.7; margin-bottom: 24px; }
        .btn { display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white !important; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; }
        .steps { background: rgba(99, 102, 241, 0.1); border-radius: 12px; padding: 20px; margin: 24px 0; }
        .step { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
        .step-num { background: #6366f1; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
        .step-text { font-size: 14px; color: #94a3b8; }
        .footer { text-align: center; font-size: 13px; color: #475569; margin-top: 40px; }
        .support { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; text-align: center; margin-top: 24px; }
        .support a { color: #10b981; text-decoration: none; font-weight: 600; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">VaultSystemFx</div>
        </div>

        <div class="card">
            <div class="title">Ciao ${order.firstName || 'Trader'}! 🎉</div>
            <p class="text">
                Grazie per aver acquistato <strong>VaultSystemFx</strong>!<br>
                Il tuo trading bot è pronto per essere scaricato.
            </p>

            <div style="text-align: center; margin: 32px 0;">
                <a href="${downloadLink}" class="btn">⬇️ Scarica VaultSystemFx</a>
            </div>

            <div class="steps">
                <div class="step">
                    <div class="step-num">1</div>
                    <div class="step-text">Scarica e estrai il file ZIP</div>
                </div>
                <div class="step">
                    <div class="step-num">2</div>
                    <div class="step-text">Avvia VaultSystemFx.exe</div>
                </div>
                <div class="step">
                    <div class="step-num">3</div>
                    <div class="step-text">Inserisci le credenziali MT5 e configura i simboli</div>
                </div>
                <div class="step">
                    <div class="step-num">4</div>
                    <div class="step-text">Clicca "Avvia Bot" e lascialo lavorare!</div>
                </div>
            </div>

            <div class="support">
                <p style="margin: 0; color: #94a3b8;">Hai bisogno di aiuto? Contattaci su Telegram:</p>
                <a href="https://t.me/Tamberax" style="font-size: 18px;">@Tamberax</a>
            </div>
        </div>

        <div class="footer">
            <p>© 2024 VaultSystemFx. Tutti i diritti riservati.</p>
            <p style="margin-top: 8px;">Questa email è stata inviata a ${order.email}</p>
        </div>
    </div>
</body>
</html>
        `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Email inviata a ${order.email}`);
}

async function sendNotificationEmail(order) {
    const notifyEmail = process.env.NOTIFY_EMAIL || process.env.EMAIL_USER;

    const mailOptions = {
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
            </ul>
        `
    };

    await transporter.sendMail(mailOptions);
    console.log('📧 Notifica inviata');
}

async function sendCryptoNotification(order) {
    const notifyEmail = process.env.NOTIFY_EMAIL || process.env.EMAIL_USER;

    const mailOptions = {
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
            <p>Dopo aver verificato il pagamento, invia manualmente l'email con:</p>
            <code>POST /api/send-manual</code>
        `
    };

    await transporter.sendMail(mailOptions);
    console.log('📧 Notifica crypto inviata');
}

// ═══════════════════════════════════════════════════════════════
// AVVIO SERVER
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           VaultSystemFx Backend Server                        ║
║                                                               ║
║   🚀 Server attivo su porta ${PORT}                             ║
║   📧 Email: ${process.env.EMAIL_USER || 'Non configurata'}
║                                                               ║
║   Endpoints:                                                  ║
║   • POST /api/complete-order  - Completa ordine               ║
║   • POST /api/paypal-webhook  - Webhook PayPal                ║
║   • POST /api/crypto-order    - Ordine crypto                 ║
║   • POST /api/send-manual     - Invio manuale (admin)         ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
