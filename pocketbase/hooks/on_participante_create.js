onRecordAfterCreateSuccess((e) => {
  try {
    const ingressoId = e.record.getString('ingresso_id')
    if (!ingressoId) return e.next()

    const ingresso = $app.findRecordById('ingressos', ingressoId)
    const compradorId = ingresso.getString('comprador_id')
    if (!compradorId) return e.next()

    const comprador = $app.findRecordById('compradores', compradorId)
    const email = comprador.getString('email')
    const nome = comprador.getString('nome')
    const participanteNome = e.record.getString('nome_completo')
    const tipo = ingresso.getString('tipo_ingresso')

    const mailer = $app.newMailClient()
    const msg = new MailerMessage({
      from: {
        address: $app.settings().meta.senderAddress || 'no-reply@adapta.org',
        name: $app.settings().meta.senderName || 'Adapta Summit 2026',
      },
      to: [{ address: email }],
      subject: `Ingresso ${tipo} preenchido por ${participanteNome}!`,
      html: `<p>Olá ${nome},</p><p>O seu ingresso ${tipo} (Pedido: ${ingresso.getString('pedido_id')}) acaba de ser preenchido por <strong>${participanteNome}</strong>.</p><p>Obrigado,<br/>Adapta Summit 2026</p>`,
    })

    mailer.send(msg)
  } catch (err) {
    $app.logger().error('Error sending email on participant create', 'error', err.message)
  }
  return e.next()
}, 'participantes')
