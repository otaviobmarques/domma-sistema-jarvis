export const metadata = { title: "Política de Privacidade · Tavinho" };

export default function Privacidade() {
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">Política de Privacidade — Tavinho</h1>
      <p className="muted">Domma Tecnologia · última atualização: 08/11/2026</p>

      <p>
        O Tavinho é um assistente de inteligência artificial oferecido pela Domma Tecnologia às empresas clientes e às pessoas que elas cadastram. Cada empresa cliente é a controladora dos dados da própria equipe; a Domma atua como operadora. Esta política explica quais dados o Tavinho acessa,
        como são usados e como você pode controlá-los, em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018).
      </p>

      <h2 className="font-semibold text-lg">1. Dados acessados</h2>
      <ul className="list-disc ml-5 space-y-1">
        <li>Cadastro do usuário: nome, e-mail, número de WhatsApp e perfil de acesso.</li>
        <li>Mensagens trocadas com o Tavinho pelo WhatsApp e pelo painel.</li>
        <li>
          Com a sua autorização explícita na conta Google: e-mails do Gmail (leitura, rascunhos e envio somente com sua confirmação), eventos do Google Agenda, arquivos do
          Google Drive (somente leitura) e dados de campanhas do Google Ads.
        </li>
        <li>Dados de outras integrações que você conectar (ex.: Meta Ads, sistemas internos da empresa).</li>
      </ul>

      <h2 className="font-semibold text-lg">2. Como os dados são usados</h2>
      <p>
        Os dados são usados exclusivamente para executar os pedidos que você faz ao Tavinho (por exemplo, resumir e-mails, marcar reuniões, gerar relatórios) e para manter a
        memória do assistente, que você pode ver, editar e apagar no painel. Não vendemos, alugamos nem compartilhamos seus dados para publicidade. Os dados obtidos das APIs
        do Google são usados de acordo com a Política de Dados do Usuário dos Serviços de API do Google, incluindo os requisitos de Uso Limitado.
      </p>

      <h2 className="font-semibold text-lg">3. Processamento por terceiros</h2>
      <p>
        Para funcionar, o Tavinho envia o conteúdo necessário de cada pedido a provedores de infraestrutura e de inteligência artificial (Anthropic, para o processamento de
        linguagem; Groq, para transcrição de áudio; Supabase e Railway, para armazenamento e hospedagem). Esses provedores tratam os dados apenas para prestar o serviço.
      </p>

      <h2 className="font-semibold text-lg">4. Segurança</h2>
      <p>
        Tokens de acesso e senhas são armazenados criptografados. Ações sensíveis (enviar mensagens a terceiros, apagar dados, alterar orçamento) exigem confirmação ou PIN.
        Todas as ações ficam registradas em log de auditoria.
      </p>

      <h2 className="font-semibold text-lg">5. Seus direitos</h2>
      <p>
        Você pode a qualquer momento consultar, corrigir ou apagar suas memórias no painel, desconectar sua conta Google (em myaccount.google.com/permissions ou no painel)
        e solicitar a exclusão completa dos seus dados pelo e-mail abaixo.
      </p>

      <h2 className="font-semibold text-lg">6. Contato</h2>
      <p>Domma Tecnologia — otaviobmarques@gmail.com</p>
    </main>
  );
}
