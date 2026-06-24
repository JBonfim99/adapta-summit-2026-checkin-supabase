onRecordUpdate((e) => {
  const original = e.record.original()
  if (
    original.getString('participante_id') &&
    e.record.getString('participante_id') !== original.getString('participante_id')
  ) {
    throw new BadRequestError('Não é possível alterar o participante de um ingresso já preenchido.')
  }
  return e.next()
}, 'ingressos')

onRecordUpdate((e) => {
  const original = e.record.original()
  if (
    original.getString('ingresso_id') &&
    e.record.getString('ingresso_id') !== original.getString('ingresso_id')
  ) {
    throw new BadRequestError('Não é possível alterar o ingresso associado a este participante.')
  }
  return e.next()
}, 'participantes')
