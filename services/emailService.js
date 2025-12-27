import nodemailer from 'nodemailer';

let transporter = null;

/**
 * Initialiser le transporteur email (Gmail)
 */
export const initializeEmailService = () => {
  try {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      console.warn('⚠️  Gmail credentials missing - Email notifications disabled');
      console.warn('   Set GMAIL_USER and GMAIL_APP_PASSWORD in .env');
      return false;
    }

    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    console.log('✅ Email service initialized (Gmail)');
    return true;
  } catch (error) {
    console.error('❌ Email service initialization failed:', error.message);
    return false;
  }
};

/**
 * Envoyer un email avec les fichiers du patch
 */
export const sendPatchEmail = async (orderData, files) => {
  if (!transporter) {
    console.error('❌ Email transporter not initialized');
    throw new Error('Email service not configured');
  }

  const {
    orderNumber,
    customerName,
    customerEmail,
    shippingAddress,
    patchId,
    orderDate,
    totalPrice
  } = orderData;

  const { originalImage, svgFile } = files;

  const addressLines = shippingAddress ? [
    shippingAddress.name,
    shippingAddress.address1,
    shippingAddress.address2,
    `${shippingAddress.zip} ${shippingAddress.city}`,
    shippingAddress.country
  ].filter(Boolean).join('\n') : 'Non renseignée';

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #2c3e50; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .info-box { background: white; padding: 15px; margin: 10px 0; border-radius: 4px; border-left: 4px solid #3498db; }
    .label { font-weight: bold; color: #555; }
    .value { margin-left: 10px; }
    .footer { text-align: center; padding: 15px; color: #777; font-size: 12px; }
    .badge { display: inline-block; background: #27ae60; color: white; padding: 5px 10px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🧵 Nouvelle commande PPATCH</h1>
      <span class="badge">Prêt à broder</span>
    </div>
    
    <div class="content">
      <div class="info-box">
        <h3>📦 Commande #${orderNumber}</h3>
        <p><span class="label">Date:</span> <span class="value">${new Date(orderDate).toLocaleString('fr-FR')}</span></p>
        <p><span class="label">Montant:</span> <span class="value">${totalPrice} €</span></p>
        <p><span class="label">Patch ID:</span> <span class="value">${patchId}</span></p>
      </div>
      
      <div class="info-box">
        <h3>👤 Client</h3>
        <p><span class="label">Nom:</span> <span class="value">${customerName}</span></p>
        <p><span class="label">Email:</span> <span class="value">${customerEmail}</span></p>
      </div>
      
      <div class="info-box">
        <h3>📍 Adresse de livraison</h3>
        <pre style="margin: 0; font-family: Arial;">${addressLines}</pre>
      </div>
      
      <div class="info-box">
        <h3>📎 Fichiers joints</h3>
        <ul>
          <li><strong>Image originale</strong> - Pour référence visuelle</li>
          <li><strong>SVG vectorisé</strong> - Prêt pour import dans PE-Design</li>
        </ul>
        <p style="color: #666; font-size: 12px;">
          💡 Le SVG contient des calques séparés par couleur pour faciliter la digitisation.
        </p>
      </div>
    </div>
    
    <div class="footer">
      <p>Email généré automatiquement par PPATCH Backend</p>
    </div>
  </div>
</body>
</html>
`;

  const mailOptions = {
    from: `"PPATCH Broderie" <${process.env.GMAIL_USER}>`,
    to: process.env.NOTIFICATION_EMAIL || 'contact@ppatch.shop',
    subject: `🧵 Commande #${orderNumber} - Patch ${patchId.substring(0, 8)} à broder`,
    html: emailHtml,
    attachments: []
  };

  if (originalImage) {
    mailOptions.attachments.push({
      filename: `patch_${patchId}_original.png`,
      content: originalImage,
      contentType: 'image/png'
    });
  }

  if (svgFile) {
    mailOptions.attachments.push({
      filename: `patch_${patchId}_vectorise.svg`,
      content: svgFile,
      contentType: 'image/svg+xml'
    });
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email envoyé pour commande #${orderNumber}:`, info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    throw error;
  }
};

/**
 * Envoyer un email de test
 */
export const sendTestEmail = async () => {
  if (!transporter) {
    throw new Error('Email service not configured');
  }

  const mailOptions = {
    from: `"PPATCH Test" <${process.env.GMAIL_USER}>`,
    to: process.env.NOTIFICATION_EMAIL || 'contact@ppatch.shop',
    subject: '✅ Test email PPATCH - Configuration OK',
    html: `
      <h1>🎉 Configuration email réussie!</h1>
      <p>Le service d'email PPATCH fonctionne correctement.</p>
      <p>Vous recevrez les commandes à cette adresse.</p>
      <p><small>Envoyé le ${new Date().toLocaleString('fr-FR')}</small></p>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  console.log('✅ Test email sent:', info.messageId);
  return info;
};
