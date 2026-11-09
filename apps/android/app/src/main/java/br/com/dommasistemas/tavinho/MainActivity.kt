package br.com.dommasistemas.tavinho

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import kotlin.math.cos
import kotlin.math.sin

private val Fundo = Color(0xFF040A14)
private val Card = Color(0xFF0B1A2C)
private val Ciano = Color(0xFF22D3EE)
private val Roxo = Color(0xFF6F5CF6)
private val Texto = Color(0xFFEAF8FF)
private val Muted = Color(0xFF8DA7B8)

class MainActivity : ComponentActivity() {
    private lateinit var falador: Falador
    private lateinit var gravador: Gravador
    private var retomarTick by mutableIntStateOf(0)

    private val pedirPermissoes = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { retomarTick++ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        falador = Falador(this)
        gravador = Gravador(this)
        if (TavinhoApp.instancia.config.pareado) ConexaoService.iniciar(this)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Ciano, background = Fundo, surface = Card)) {
                Surface(Modifier.fillMaxSize(), color = Fundo) { Raiz() }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        retomarTick++
    }

    override fun onDestroy() {
        falador.fechar()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- permissões
    fun acessibilidadeAtiva(): Boolean {
        val alvo = ComponentName(this, TavinhoAcessibilidade::class.java).flattenToString()
        val lista = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        return lista.split(':').any { it.equals(alvo, ignoreCase = true) }
    }

    fun notificacoesAtivas(): Boolean {
        val lista = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: ""
        return lista.contains(packageName)
    }

    fun bateriaLivre(): Boolean = getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)

    fun temPermissao(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    fun pedir(vararg p: String) = pedirPermissoes.launch(arrayOf(*p))

    fun abrirAcessibilidade() = startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    fun abrirNotificacoes() = startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    fun abrirBateria() {
        runCatching {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        }.onFailure { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
    }

    // ---------------------------------------------------------------- telas
    @Composable
    fun Raiz() {
        val cfg = TavinhoApp.instancia.config
        var pareado by remember { mutableStateOf(cfg.pareado) }
        var onboarding by remember { mutableStateOf(cfg.onboardingFeito) }
        val conexao by Estado.conexao.collectAsState()
        LaunchedEffect(conexao) { if (conexao == "desconectado") pareado = cfg.pareado }
        when {
            !pareado -> TelaParear { pareado = true; ConexaoService.iniciar(this) }
            !onboarding -> TelaPermissoes { cfg.onboardingFeito = true; onboarding = true }
            else -> TelaInicio(onDesparear = { pareado = false }, onPermissoes = { onboarding = false })
        }
    }

    @Composable
    fun TelaParear(aoParear: () -> Unit) {
        val cfg = TavinhoApp.instancia.config
        var codigo by remember { mutableStateOf("") }
        var nome by remember { mutableStateOf(cfg.nomeAparelho) }
        var servidor by remember { mutableStateOf(cfg.servidor) }
        var erro by remember { mutableStateOf<String?>(null) }
        var carregando by remember { mutableStateOf(false) }
        Column(Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Spacer(Modifier.height(24.dp))
            Text("TAVINHO", color = Texto, fontSize = 34.sp, fontWeight = FontWeight.Black)
            Text("by Domma Tecnologia", color = Muted)
            Spacer(Modifier.height(8.dp))
            Text("Conectar este celular", color = Texto, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            Text("No painel (jarvis.dommasistemas.com.br) vá em Dispositivos → Gerar código de pareamento e digite o código aqui.", color = Muted)
            OutlinedTextField(codigo, { codigo = it.uppercase().take(8) }, label = { Text("Código") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(nome, { nome = it }, label = { Text("Nome deste celular") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(servidor, { servidor = it }, label = { Text("Servidor") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            erro?.let { Text(it, color = Color(0xFFFCA5A5)) }
            Button(
                onClick = {
                    carregando = true
                    erro = null
                    lifecycleScope.launch {
                        try {
                            val r = Api(servidor, null).post(
                                "/device/pair",
                                JSONObject().put("codigo", codigo).put("nome", nome).put("tipo", "android")
                                    .put("info", JSONObject().put("os", "Android ${Build.VERSION.RELEASE}").put("versao_app", BuildConfig.VERSION_NAME)),
                            )
                            cfg.servidor = servidor
                            cfg.token = r.getString("token")
                            cfg.deviceId = r.getString("device_id")
                            cfg.usuario = r.optString("usuario")
                            aoParear()
                        } catch (e: Exception) {
                            erro = e.message ?: "Não consegui conectar."
                        } finally {
                            carregando = false
                        }
                    }
                },
                enabled = codigo.length >= 4 && !carregando,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Roxo),
            ) { Text(if (carregando) "Conectando…" else "Conectar", fontWeight = FontWeight.Bold) }
        }
    }

    @Composable
    fun TelaPermissoes(aoContinuar: () -> Unit) {
        val tick = retomarTick
        val ac = remember(tick) { acessibilidadeAtiva() }
        val nt = remember(tick) { notificacoesAtivas() }
        val bt = remember(tick) { bateriaLivre() }
        val mic = remember(tick) { temPermissao(Manifest.permission.RECORD_AUDIO) }
        val aviso = remember(tick) { Build.VERSION.SDK_INT < 33 || temPermissao(Manifest.permission.POST_NOTIFICATIONS) }
        Column(Modifier.fillMaxSize().padding(22.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("PASSO 2 DE 2", color = Ciano, fontSize = 12.sp, letterSpacing = 3.sp)
            Text("Libere o que o Tavinho pode fazer no celular", color = Texto, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text("Você pode mudar isso depois. Em bancos e apps de pagamento ele sempre para e pede você.", color = Muted)
            ItemPermissao("Acessibilidade", "Ler a tela, tocar e digitar por você", ac) { abrirAcessibilidade() }
            ItemPermissao("Notificações", "Resumir e avisar o que é importante", nt) { abrirNotificacoes() }
            ItemPermissao("Bateria sem restrição", "Evita que o sistema feche o Tavinho em segundo plano", bt) { abrirBateria() }
            ItemPermissao("Microfone", "Só enquanto você segura o botão de falar", mic) { pedir(Manifest.permission.RECORD_AUDIO) }
            ItemPermissao("Avisos do Tavinho", "Mostrar \"Tavinho executando\" com botão de parar", aviso) {
                if (Build.VERSION.SDK_INT >= 33) pedir(Manifest.permission.POST_NOTIFICATIONS)
            }
            ItemPermissao("Ligações (opcional)", "Para ligar direto quando você pedir", temPermissao(Manifest.permission.CALL_PHONE)) { pedir(Manifest.permission.CALL_PHONE) }
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0x33F59E0B)).padding(12.dp)) {
                Text("Xiaomi, Samsung e Motorola às vezes fecham apps em segundo plano. Se o Tavinho parar de responder, procure \"Inicialização automática\" ou \"Apps em suspensão\" nas configurações e libere o Tavinho.", color = Color(0xFFFDE68A), fontSize = 13.sp)
            }
            Button(onClick = aoContinuar, modifier = Modifier.fillMaxWidth().height(52.dp), colors = ButtonDefaults.buttonColors(containerColor = Roxo)) {
                Text("Continuar", fontWeight = FontWeight.Bold)
            }
        }
    }

    @Composable
    fun ItemPermissao(titulo: String, desc: String, ativo: Boolean, aoAtivar: () -> Unit) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Card).border(1.dp, if (ativo) Color(0x5510B981) else Color(0x3322D3EE), RoundedCornerShape(14.dp)).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(titulo, color = Texto, fontWeight = FontWeight.SemiBold)
                Text(desc, color = Muted, fontSize = 13.sp)
            }
            if (ativo) Text("Ativado", color = Color(0xFF34D399), fontWeight = FontWeight.Bold)
            else OutlinedButton(onClick = aoAtivar) { Text("Ativar") }
        }
    }

    @Composable
    fun TelaInicio(onDesparear: () -> Unit, onPermissoes: () -> Unit) {
        val cfg = TavinhoApp.instancia.config
        val conexao by Estado.conexao.collectAsState()
        val acao by Estado.acaoAtual.collectAsState()
        val msgServico by Estado.mensagem.collectAsState()
        val falando by falador.falando.collectAsState()
        var modo by remember { mutableStateOf("") } // "", ouvindo, pensando
        var legenda by remember { mutableStateOf("Segure para falar") }
        var texto by remember { mutableStateOf("") }
        var nivel by remember { mutableFloatStateOf(0f) }
        var tarefas by remember { mutableStateOf(listOf<Pair<String, String>>()) }
        var pausado by remember { mutableStateOf(false) }
        var mostrarConfig by remember { mutableStateOf(false) }
        val nomeAss = remember { mutableStateOf(cfg.nomeAssistente) }
        val primeiroNome = (cfg.usuario ?: "").replace(Regex("\\(.*?\\)"), "").trim().split(" ").firstOrNull().orEmpty()

        suspend fun atualizar() {
            runCatching {
                val me = TavinhoApp.instancia.api().get("/device/me")
                me.optJSONObject("usuario")?.let { u ->
                    pausado = u.optBoolean("pausado")
                    u.optString("nome_assistente").takeIf { it.isNotBlank() }?.let { cfg.nomeAssistente = it; nomeAss.value = it }
                }
                val t = TavinhoApp.instancia.api().get("/device/tarefas").optJSONArray("tarefas")
                if (t != null) tarefas = (0 until t.length()).map { t.getJSONObject(it).let { o -> o.optString("pedido") to o.optString("status") } }
            }
        }
        LaunchedEffect(Unit) { atualizar() }
        LaunchedEffect(msgServico) { msgServico?.let { legenda = it; pausado = true; Estado.mensagem.value = null } }

        fun enviar(t: String, voz: Boolean) {
            val pedido = t.trim()
            if (pedido.isEmpty()) return
            falador.parar()
            modo = "pensando"
            legenda = "Pensando…"
            val frases = Frases { falador.falar(it) }
            var aoVivo = ""
            lifecycleScope.launch {
                try {
                    val fim = TavinhoApp.instancia.api().chatStream(pedido, voz) { d ->
                        frases.adicionar(d)
                        aoVivo += d
                        lifecycleScope.launch(Dispatchers.Main) { legenda = aoVivo.replace("*", "") }
                    }
                    frases.terminar()
                    val resp = fim.optString("resposta").ifBlank { aoVivo }
                    if (aoVivo.isBlank()) resp.split(Regex("(?<=[.!?])\\s+")).forEach { falador.falar(it) }
                    legenda = resp.replace("*", "")
                } catch (e: Exception) {
                    legenda = "⚠️ ${e.message}"
                } finally {
                    modo = ""
                    atualizar()
                }
            }
        }

        // nível do microfone para a animação
        LaunchedEffect(modo) {
            while (modo == "ouvindo") {
                nivel = gravador.nivel()
                delay(70)
            }
            nivel = 0f
        }

        val estadoVisual = when {
            modo == "ouvindo" -> "ouvindo"
            modo == "pensando" || acao != null -> "pensando"
            falando -> "falando"
            pausado -> "erro"
            else -> ""
        }

        Column(Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(nomeAss.value.uppercase(), color = Ciano, fontSize = 12.sp, letterSpacing = 3.sp)
                    Text(saudacao() + if (primeiroNome.isNotEmpty()) ", $primeiroNome" else "", color = Texto, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                }
                val (cor, rotulo) = when (conexao) {
                    "online" -> Color(0xFF10B981) to "Conectado"
                    "offline" -> Color(0xFFF59E0B) to "Sem conexão"
                    else -> Color(0xFF94A3B8) to "Conectando…"
                }
                Row(Modifier.clip(RoundedCornerShape(50)).background(cor.copy(alpha = 0.15f)).padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(cor))
                    Spacer(Modifier.width(6.dp))
                    Text(rotulo, color = cor, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
                IconButton(onClick = { mostrarConfig = true }) { Icon(Icons.Default.Settings, null, tint = Muted) }
            }

            // cartão "segure para falar"
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Brush.verticalGradient(listOf(Color(0xFF0B2238), Color(0xFF07121F)))).padding(vertical = 18.dp, horizontal = 14.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier.size(200.dp).pointerInput(Unit) {
                        detectTapGestures(onPress = {
                            if (!temPermissao(Manifest.permission.RECORD_AUDIO)) {
                                pedir(Manifest.permission.RECORD_AUDIO)
                                return@detectTapGestures
                            }
                            falador.parar()
                            runCatching { gravador.iniciar() }.onFailure { legenda = "Não consegui usar o microfone."; return@detectTapGestures }
                            modo = "ouvindo"
                            legenda = "Ouvindo… solte para enviar"
                            tryAwaitRelease()
                            val audio = gravador.parar()
                            if (audio == null) {
                                modo = ""
                                legenda = "Segure enquanto fala."
                                return@detectTapGestures
                            }
                            modo = "pensando"
                            legenda = "Entendendo…"
                            lifecycleScope.launch {
                                val t = runCatching {
                                    TavinhoApp.instancia.api().post("/device/transcribe", JSONObject().put("audio", audio).put("mime", "audio/mp4"), 60).optString("texto")
                                }.getOrElse { legenda = "⚠️ ${it.message}"; modo = ""; return@launch }
                                if (t.isBlank()) {
                                    legenda = "Não entendi. Pode repetir?"
                                    modo = ""
                                } else enviar(t, voz = true)
                            }
                        })
                    },
                    contentAlignment = Alignment.Center,
                ) {
                    Hud(estadoVisual, nivel)
                    Icon(Icons.Default.Mic, null, tint = Color.White, modifier = Modifier.size(44.dp))
                }
                Text(
                    when (estadoVisual) { "ouvindo" -> "OUVINDO"; "pensando" -> "EXECUTANDO"; "falando" -> "FALANDO"; "erro" -> "PAUSADO"; else -> "SEGURE PARA FALAR" },
                    color = corEstado(estadoVisual), fontSize = 12.sp, letterSpacing = 3.sp, fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(6.dp))
                Text(acao?.let { "🖐 $it" } ?: legenda, color = Texto, textAlign = TextAlign.Center, fontSize = 15.sp, maxLines = 6)
            }

            // atalhos
            val atalhos = listOf("Resumo das notificações", "Minha agenda hoje", "E-mails importantes", "O que tem na minha tela?")
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                atalhos.chunked(2).forEach { par ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        par.forEach { a ->
                            Box(
                                Modifier.weight(1f).clip(RoundedCornerShape(14.dp)).background(Card).border(1.dp, Color(0x2222D3EE), RoundedCornerShape(14.dp)).clickable { enviar(a, voz = cfg.falarRespostas) }.padding(12.dp),
                            ) { Text(a, color = Texto, fontSize = 14.sp) }
                        }
                    }
                }
            }

            // caixa de texto
            OutlinedTextField(
                texto, { texto = it }, modifier = Modifier.fillMaxWidth(), placeholder = { Text("Mensagem ou /parar") }, singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { enviar(texto, false); texto = "" }),
                trailingIcon = { IconButton(onClick = { enviar(texto, false); texto = "" }) { Icon(Icons.Default.Send, null, tint = Ciano) } },
            )

            // últimas tarefas
            Column(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Card).padding(14.dp).verticalScroll(rememberScrollState())) {
                Text("Últimas tarefas", color = Texto, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                if (tarefas.isEmpty()) Text("Nada ainda.", color = Muted, fontSize = 13.sp)
                tarefas.forEach { (p, s) ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(p, color = Texto, fontSize = 13.sp, modifier = Modifier.weight(1f), maxLines = 1)
                        Text(
                            when (s) { "concluida" -> "Feito"; "executando" -> "Executando"; "aguardando_aprovacao" -> "Aguardando"; "erro" -> "Erro"; else -> s },
                            color = if (s == "concluida") Color(0xFF34D399) else Ciano, fontSize = 12.sp,
                        )
                    }
                }
            }

            // parar / retomar
            if (pausado) {
                Button(
                    onClick = { lifecycleScope.launch { runCatching { TavinhoApp.instancia.api().post("/device/resume") }; pausado = false; legenda = "Voltei. Segure para falar." } },
                    modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981)),
                ) { Text("▶ Retomar", fontWeight = FontWeight.Bold, color = Color(0xFF04111D)) }
            } else {
                OutlinedButton(
                    onClick = {
                        falador.parar()
                        Acoes.PARAR = true
                        lifecycleScope.launch { runCatching { TavinhoApp.instancia.api().post("/device/panic") }; pausado = true; legenda = "⛔ Parei tudo." }
                    },
                    modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFFCA5A5)),
                ) { Text("⛔ Parar tudo agora", fontWeight = FontWeight.Bold) }
            }
        }

        if (mostrarConfig) {
            var falar by remember { mutableStateOf(cfg.falarRespostas) }
            var vel by remember { mutableFloatStateOf(cfg.velocidade) }
            AlertDialog(
                onDismissRequest = { mostrarConfig = false },
                confirmButton = { TextButton(onClick = { cfg.falarRespostas = falar; cfg.velocidade = vel; mostrarConfig = false }) { Text("Salvar") } },
                dismissButton = {
                    TextButton(onClick = {
                        lifecycleScope.launch {
                            withContext(Dispatchers.IO) { cfg.desparear() }
                            mostrarConfig = false
                            onDesparear()
                        }
                    }) { Text("Desconectar celular", color = Color(0xFFFCA5A5)) }
                },
                title = { Text("Configurações") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Responder falando", Modifier.weight(1f))
                            Switch(falar, { falar = it })
                        }
                        Text("Velocidade da fala: ${"%.2f".format(vel)}x")
                        Slider(vel, { vel = it }, valueRange = 0.9f..1.4f)
                        TextButton(onClick = { mostrarConfig = false; onPermissoes() }) { Text("Revisar permissões") }
                        Text("${cfg.nomeAparelho} · v${BuildConfig.VERSION_NAME}", color = Muted, fontSize = 12.sp)
                    }
                },
            )
        }
    }

    private fun saudacao(): String {
        val h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        return if (h < 12) "Bom dia" else if (h < 18) "Boa tarde" else "Boa noite"
    }
}

private fun corEstado(e: String) = when (e) {
    "ouvindo" -> Color(0xFF3B82F6)
    "falando" -> Color(0xFF10B981)
    "pensando" -> Color(0xFFA78BFA)
    "erro" -> Color(0xFFEF4444)
    else -> Ciano
}

/** HUD animado do Tavinho (anéis girando, reage à voz). */
@Composable
private fun Hud(estado: String, nivel: Float) {
    val cor = corEstado(estado)
    val t = rememberInfiniteTransition(label = "hud")
    val vel = when (estado) { "pensando" -> 2600; "ouvindo", "falando" -> 5000; else -> 9000 }
    val giro by t.animateFloat(0f, 360f, infiniteRepeatable(tween(vel, easing = LinearEasing)), label = "giro")
    val respiro by t.animateFloat(0.96f, 1.04f, infiniteRepeatable(tween(1400), RepeatMode.Reverse), label = "respiro")
    Canvas(Modifier.fillMaxSize()) {
        val c = Offset(size.width / 2, size.height / 2)
        val r = size.minDimension / 2
        drawCircle(Brush.radialGradient(listOf(cor.copy(alpha = 0.25f + nivel * 0.3f), Color.Transparent), c, r), r, c)
        drawCircle(cor.copy(alpha = 0.25f), r * 0.97f, c, style = Stroke(2f))
        for (i in 0 until 72) {
            val a = Math.toRadians((i * 5 - giro * 0.2).toDouble())
            val r1 = r * 0.80f
            val r2 = r1 + if (i % 6 == 0) r * 0.07f else r * 0.04f
            drawLine(cor.copy(alpha = if (i % 6 == 0) 0.8f else 0.4f), Offset(c.x + cos(a).toFloat() * r1, c.y + sin(a).toFloat() * r1), Offset(c.x + cos(a).toFloat() * r2, c.y + sin(a).toFloat() * r2), 3f)
        }
        listOf(20f to 70f, 130f to 60f, 220f to 90f).forEach { (ini, varre) ->
            drawArc(cor, ini + giro, varre, false, Offset(c.x - r * 0.68f, c.y - r * 0.68f), androidx.compose.ui.geometry.Size(r * 1.36f, r * 1.36f), style = Stroke(r * (0.035f + nivel * 0.03f), cap = StrokeCap.Round))
        }
        drawCircle(Color(0xFF0B2A40), r * 0.50f * (respiro + nivel * 0.12f), c)
        drawCircle(cor.copy(alpha = 0.9f), r * 0.50f * (respiro + nivel * 0.12f), c, style = Stroke(4f))
    }
}
