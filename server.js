/**
 * VaultSystemFx - Backend Server
 * Gestisce pagamenti PayPal e invio email automatico
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    standard: process.env.DOWNLOAD_LINK_STANDARD || 'https://www.dropbox.com/scl/fi/l5n3cysy5kyeh0525f8la/test.zip?rlkey=p49q4d2nkvjsvkssig946tn38&st=3gz0e6hp&dl=1',
    student: process.env.DOWNLOAD_LINK_STUDENT || 'https://www.dropbox.com/scl/fi/l5n3cysy5kyeh0525f8la/test.zip?rlkey=p49q4d2nkvjsvkssig946tn38&st=3gz0e6hp&dl=1'
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
// ROUTE: Stripe - Crea Payment Intent
// ═══════════════════════════════════════════════════════════════
app.post('/api/create-payment-intent', async (req, res) => {
    try {
        const { amount, email, firstName, lastName } = req.body;

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Stripe usa centesimi
            currency: 'eur',
            receipt_email: email,
            metadata: {
                firstName,
                lastName,
                email
            }
        });

        res.json({ clientSecret: paymentIntent.client_secret });

    } catch (error) {
        console.error('❌ Stripe error:', error);
        res.status(500).json({ error: error.message });
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
        .step { display: flex; align-items: flex-start; gap: 20px; padding: 16px 0; border-bottom: 1px solid #f1f3f6; }
        .step:last-child { border-bottom: none; }
        .step-num { width: 32px; height: 32px; min-width: 32px; border-radius: 10px; background: #f4f5ff; border: 1px solid #e0e1ff; text-align: center; line-height: 32px; font-size: 13px; font-weight: 700; color: #6366f1; margin-right: 16px; }
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
                        <span class="step-title"> Crea account Fortune Prime Global</span>
                        <span class="step-desc">Registrati gratuitamente sul nostro broker partner per utilizzare il bot. <a href="https://portal.fortuneprime.com/getview?view=register&token=0pSM1g" style="color: #6366f1; font-weight: 600;">Clicca qui per registrarti</a></span>
                    </div>
                </div>
                <div class="step">
                    <div class="step-num">2</div>
                    <div class="step-content">
                        <span class="step-title"> Scarica e decomprimi</span>
                        <span class="step-desc">Scarica il file ZIP sul tuo PC o VPS ed estrailo. Nella cartella troverai il bot e il programma MT5 da installare. MT5 dovr&agrave; restare sempre aperto durante l'utilizzo del bot.</span>
                    </div>
                </div>
                <div class="step">
                    <div class="step-num">3</div>
                    <div class="step-content">
                        <span class="step-title"> Avvia l'applicazione</span>
                        <span class="step-desc">Esegui <span class="code">VaultSystemFx.exe</span> come amministratore.</span>
                    </div>
                </div>
                <div class="step">
                    <div class="step-num">4</div>
                    <div class="step-content">
                        <span class="step-title"> Configura MT5</span>
                        <span class="step-desc">Inserisci le credenziali del tuo conto MT5 e seleziona i simboli da tradare.</span>
                    </div>
                </div>
                <div class="step">
                    <div class="step-num">5</div>
                    <div class="step-content">
                        <span class="step-title"> Avvia il bot</span>
                        <span class="step-desc">Clicca su "Avvia Bot" e lascia che VaultSystemFx lavori per te.</span>
                    </div>
                </div>

                <div class="support">
                    <p>Hai bisogno di supporto?</p>
                    <a href="mailto:${SUPPORT_EMAIL}">✉️ ${SUPPORT_EMAIL}</a>
                </div>
            </div>

            <div class="card-footer">
                <p class="footer-text">© 2026 VaultSystemFx — Tutti i diritti riservati</p>
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

    // Email all'admin
    await transporter.sendMail({
        from: `"VaultSystemFx Bot" <${process.env.EMAIL_USER}>`,
        to: notifyEmail,
        subject: `🪙 USDT: Verifica pagamento - ${order.firstName} ${order.lastName}`,
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; background: #f0f2f5; padding: 24px; }
        .card { max-width: 500px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e5ea; }
        .header { background: linear-gradient(135deg, #26A17B, #1a7a5c); padding: 24px; text-align: center; }
        .header h1 { color: #fff; font-size: 18px; margin: 0; }
        .body { padding: 24px; }
        .field { margin-bottom: 14px; padding: 12px 16px; background: #f8f9fb; border-radius: 10px; }
        .field-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .field-value { font-size: 15px; color: #1e293b; font-weight: 600; }
        .txid { font-family: monospace; font-size: 13px; background: #fef3c7; color: #92400e; padding: 10px 14px; border-radius: 8px; word-break: break-all; }
        .alert { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 10px; padding: 14px; margin-top: 16px; text-align: center; }
        .alert p { color: #92400e; font-weight: 600; margin: 0; font-size: 14px; }
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <h1>💰 Nuovo Pagamento USDT da Verificare</h1>
        </div>
        <div class="body">
            <div class="field">
                <div class="field-label">Cliente</div>
                <div class="field-value">${order.firstName} ${order.lastName}</div>
            </div>
            <div class="field">
                <div class="field-label">Email</div>
                <div class="field-value">${order.email}</div>
            </div>
            <div class="field">
                <div class="field-label">Telegram</div>
                <div class="field-value">${order.telegram || 'Non fornito'}</div>
            </div>
            <div class="field">
                <div class="field-label">Piano</div>
                <div class="field-value">${order.plan} — €${order.amount}</div>
            </div>
            <div class="field">
                <div class="field-label">Rete</div>
                <div class="field-value">${order.network || 'TRC-20'}</div>
            </div>
            <div class="field">
                <div class="field-label">Transaction ID (TxID)</div>
                <div class="txid">${order.txId || 'Non fornito'}</div>
            </div>
            <div class="field">
                <div class="field-label">Data ordine</div>
                <div class="field-value">${new Date(order.createdAt).toLocaleString('it-IT')}</div>
            </div>
            <div class="alert">
                <p>⚠️ Verifica il pagamento e invia il bot manualmente</p>
            </div>
        </div>
    </div>
</body>
</html>`
    });
    console.log('📧 Notifica crypto inviata all\'admin');

    // Email al cliente
    await sendCryptoConfirmationToCustomer(order);
}

async function sendCryptoConfirmationToCustomer(order) {
    await transporter.sendMail({
        from: `"VaultSystemFx" <${process.env.EMAIL_USER}>`,
        to: order.email,
        subject: '⏳ Ordine ricevuto — Verifica in corso',
        html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; background: #f0f2f5; padding: 32px 16px; }
        .wrap { max-width: 560px; margin: 0 auto; }
        .card { background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .card-header { background: linear-gradient(135deg, #0a0d18 0%, #1a1f2e 100%); padding: 48px 40px; text-align: center; }
        .logo-img { width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 20px; display: block; border: 3px solid rgba(38,161,123,0.5); }
        .brand-name { font-size: 14px; font-weight: 600; color: #94a3b8; margin-bottom: 24px; letter-spacing: 2px; text-transform: uppercase; }
        .badge { display: inline-block; background: rgba(38,161,123,0.2); border: 1px solid rgba(38,161,123,0.4); border-radius: 50px; padding: 10px 24px; font-size: 13px; font-weight: 700; color: #6ee7b7; margin-bottom: 28px; letter-spacing: 1px; text-transform: uppercase; }
        .header-title { font-size: 36px; font-weight: 800; color: #ffffff; line-height: 1.2; margin-bottom: 16px; }
        .header-sub { font-size: 16px; color: #94a3b8; line-height: 1.7; }
        .header-sub strong { color: #6ee7b7; font-weight: 600; }
        .card-body { padding: 40px; }
        .info-box { background: linear-gradient(135deg, rgba(38,161,123,0.1), rgba(38,161,123,0.03)); border: 1px solid rgba(38,161,123,0.25); border-radius: 16px; padding: 28px; margin-bottom: 28px; }
        .info-title { font-size: 18px; font-weight: 700; color: #26A17B; margin-bottom: 16px; }
        .info-text { font-size: 15px; color: #475569; line-height: 1.8; }
        .order-details { background: #f8f9fb; border-radius: 16px; padding: 8px 0; margin-bottom: 32px; }
        .order-row { display: table; width: 100%; padding: 16px 28px; border-bottom: 1px solid #e9ebef; }
        .order-row:last-child { border-bottom: none; }
        .order-label { display: table-cell; width: 130px; font-size: 14px; color: #64748b; font-weight: 500; vertical-align: middle; }
        .order-value { display: table-cell; font-size: 14px; color: #1e293b; font-weight: 600; text-align: right; vertical-align: middle; }
        .support { text-align: center; }
        .support-title { font-size: 16px; color: #334155; font-weight: 700; margin-bottom: 20px; }
        .support-btn { display: inline-block; padding: 14px 32px; border-radius: 12px; font-size: 14px; font-weight: 600; text-decoration: none; margin: 6px; }
        .support-btn.email { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #ffffff; }
        .support-btn.telegram { background: linear-gradient(135deg, #0088cc, #00aaff); color: #ffffff; }
        .card-footer { background: #f8f9fb; border-top: 1px solid #e9ebef; padding: 24px 40px; text-align: center; }
        .footer-text { font-size: 12px; color: #94a3b8; line-height: 2; }
    </style>
</head>
<body>
    <div class="wrap">
        <div class="card">
            <div class="card-header">
                <img src="${LOGO_URL}" alt="VaultSystemFx Logo" class="logo-img" />
                <div class="brand-name">VaultSystemFx</div>
                <div class="badge">✓ Ordine Ricevuto</div>
                <div class="header-title">Grazie, ${order.firstName || 'Trader'}!</div>
                <p class="header-sub">Abbiamo ricevuto il tuo ordine e stiamo verificando<br>il pagamento <strong>USDT</strong> sulla rete <strong>TRC-20</strong></p>
            </div>

            <div class="card-body">
                <div class="info-box">
                    <div class="info-title">⏳ Verifica in corso</div>
                    <div class="info-text">
                        Stiamo controllando la transazione sulla blockchain Tron.
                        Una volta confermato il pagamento, riceverai un'email con il link per scaricare <strong>VaultSystemFx</strong>.
                        <br><br>
                        <strong>Tempo stimato:</strong> entro 24 ore (solitamente molto meno)
                    </div>
                </div>

                <div class="order-details">
                    <div class="order-row">
                        <span class="order-label">Prodotto</span>
                        <span class="order-value">VaultSystemFx</span>
                    </div>
                    <div class="order-row">
                        <span class="order-label">Piano</span>
                        <span class="order-value">${order.plan}</span>
                    </div>
                    <div class="order-row">
                        <span class="order-label">Importo</span>
                        <span class="order-value">${order.amount} USDT</span>
                    </div>
                    <div class="order-row">
                        <span class="order-label">Rete</span>
                        <span class="order-value">TRC-20 (Tron)</span>
                    </div>
                    <div class="order-row">
                        <span class="order-label">TxID</span>
                        <span class="order-value" style="font-family: 'Courier New', monospace; font-size: 12px; word-break: break-all; max-width: 260px;">${order.txId || 'Non fornito'}</span>
                    </div>
                </div>

                <div class="support">
                    <div class="support-title">Hai bisogno di assistenza?</div>
                    <a href="mailto:${SUPPORT_EMAIL}" class="support-btn email">✉️ Scrivici un'Email</a>
                    <a href="https://t.me/AssistenzaVaultSystem" class="support-btn telegram">💬 Contattaci su Telegram</a>
                </div>
            </div>

            <div class="card-footer">
                <p class="footer-text">© 2026 VaultSystemFx — Tutti i diritti riservati<br>Email inviata a ${order.email}</p>
            </div>
        </div>
    </div>
</body>
</html>`
    });
    console.log(`📧 Email conferma ordine crypto inviata a ${order.email}`);
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