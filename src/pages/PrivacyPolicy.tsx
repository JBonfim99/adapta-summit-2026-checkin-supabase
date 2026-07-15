import { Link } from 'react-router-dom'

export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto py-4 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Política de Privacidade</h1>
        <p className="text-muted-foreground mt-2">
          Adapta Summit 2026 · Última atualização: 15 de julho de 2026
        </p>
      </div>

      <div className="space-y-8 text-slate-700 leading-relaxed">
        <p>
          Esta Política de Privacidade descreve como tratamos os dados pessoais coletados no
          processo de credenciamento e comunicação do evento <strong>Adapta Summit 2026</strong>, em
          conformidade com a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados — LGPD).
        </p>

        <p>
          <strong>
            Ao utilizar esta plataforma e realizar o seu pré-credenciamento para o Adapta Summit
            2026, você declara ter lido e concordar integralmente com todos os termos desta página
          </strong>
          , incluindo a autorização de uso de imagem, voz e dados descrita no item 4.
        </p>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">1. Controlador dos dados</h2>
          <p>
            O controlador responsável pelo tratamento dos seus dados é a{' '}
            <strong>Adapta Educação Ltda.</strong>, inscrita no CNPJ sob o nº{' '}
            <strong>26.081.999/0001-34</strong>.
          </p>
          <p>
            Para qualquer assunto relacionado à privacidade e aos seus dados, incluindo o exercício
            dos seus direitos, entre em contato com o nosso Encarregado pelo Tratamento de Dados
            (DPO) pelo e-mail{' '}
            <a href="mailto:privacidade@adapta.org" className="text-primary underline">
              privacidade@adapta.org
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">2. Dados que coletamos</h2>
          <p>No processo de credenciamento, coletamos:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Dados de identificação:</strong> nome completo, e-mail, CPF e telefone.
            </li>
            <li>
              <strong>Dados de perfil profissional:</strong> empresa ou profissão, cargo, segmento
              de atuação, faturamento e número de funcionários, além das respostas fornecidas no
              formulário (por exemplo, sobre uso de inteligência artificial).
            </li>
            <li>
              <strong>Dados da compra:</strong> informações do pedido recebidas da plataforma de
              venda de ingressos.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">3. Para que usamos seus dados</h2>
          <p>Seus dados são utilizados exclusivamente para:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>realizar o seu credenciamento e emitir a sua credencial de acesso ao evento;</li>
            <li>
              comunicar você a respeito do Adapta Summit 2026 (informações, acessos e atualizações
              do evento).
            </li>
          </ul>
          <p>Não utilizamos seus dados para nenhuma outra finalidade.</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">
            4. Autorização de uso de imagem, voz e dados
          </h2>
          <p>
            Ao me inscrever e participar deste evento, autorizo de forma gratuita e por prazo
            indeterminado, a captação de minha imagem, voz e demais dados de identificação por meio
            de fotografias, vídeos e gravações realizadas durante o evento, bem como a utilização
            desse material pela ADAPTA EDUCAÇÃO LTDA. inscrita sob o CNPJ 26.081.999/0001-34, em
            território nacional e internacional, para fins de divulgação institucional, promocional
            e publicitária, em quaisquer meios de comunicação, incluindo, mas não se limitando a,
            redes sociais, site oficial, materiais impressos, apresentações e demais canais de
            mídia. Declaro estar ciente de que essa autorização não implica qualquer tipo de
            remuneração ou contraprestação financeira.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">5. Base legal</h2>
          <p>
            O tratamento dos seus dados se fundamenta no <strong>consentimento</strong> fornecido
            por você ao realizar o credenciamento e na <strong>execução do contrato</strong>{' '}
            referente à sua compra e participação no evento, conforme o art. 7º da LGPD.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">6. Compartilhamento de dados</h2>
          <p>
            <strong>Não vendemos nem divulgamos seus dados pessoais a terceiros.</strong> Para
            viabilizar o credenciamento e a comunicação do evento, seus dados são tratados por
            prestadores de serviço (operadores), que atuam sob nossas instruções e apenas para as
            finalidades acima:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>INAC (credenciamento.digital):</strong> sistema de credenciamento — geração da
              credencial e do QR Code.
            </li>
            <li>
              <strong>SendGrid:</strong> envio de e-mails do evento.
            </li>
            <li>
              <strong>BotConversa:</strong> envio de mensagens via WhatsApp.
            </li>
          </ul>
          <p>
            Também podemos compartilhar dados quando exigido por obrigação legal, regulatória ou
            ordem de autoridade competente.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">7. Por quanto tempo guardamos</h2>
          <p>
            Mantemos seus dados pessoais enquanto durar a sua relação com o evento e por até{' '}
            <strong>6 (seis) meses após o término do Adapta Summit 2026</strong>, salvo quando a
            guarda por prazo maior for exigida por obrigação legal. Após esse período, os dados são
            eliminados ou anonimizados.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">8. Seus direitos</h2>
          <p>
            Nos termos do art. 18 da LGPD, você pode, a qualquer momento, solicitar: confirmação da
            existência de tratamento; acesso aos dados; correção de dados incompletos, inexatos ou
            desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários ou
            excessivos; portabilidade; informação sobre o compartilhamento; e a revogação do
            consentimento.
          </p>
          <p>
            Para exercer seus direitos, basta enviar um e-mail para{' '}
            <a href="mailto:privacidade@adapta.org" className="text-primary underline">
              privacidade@adapta.org
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">9. Segurança</h2>
          <p>
            Adotamos medidas técnicas e organizacionais razoáveis para proteger seus dados contra
            acessos não autorizados e situações de destruição, perda, alteração ou divulgação
            indevidas.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">10. Público maior de idade</h2>
          <p>
            O credenciamento e o evento destinam-se exclusivamente a maiores de 18 anos. Não
            coletamos intencionalmente dados de menores de idade.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">11. Armazenamento no navegador</h2>
          <p>
            Utilizamos armazenamento local do seu navegador apenas para manter a sua sessão e o
            funcionamento da plataforma de credenciamento. Não utilizamos cookies para rastreamento
            publicitário.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-900">12. Alterações desta política</h2>
          <p>
            Esta Política de Privacidade pode ser atualizada periodicamente. A versão vigente estará
            sempre disponível nesta página, com a data da última atualização indicada no topo.
          </p>
        </section>

        <div className="pt-4 border-t">
          <Link to="/" className="text-primary underline">
            ← Voltar
          </Link>
        </div>
      </div>
    </div>
  )
}
