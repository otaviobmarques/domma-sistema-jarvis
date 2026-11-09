package br.com.dommasistemas.tavinho

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume

/**
 * Serviço de Acessibilidade: lê a árvore de elementos da tela (mais rápido e
 * preciso que um print) e toca, digita, rola e navega pelo usuário.
 */
class TavinhoAcessibilidade : AccessibilityService() {
    private var ultimaLista: List<AccessibilityNodeInfo> = emptyList()
    var appAtual: String = ""
        private set

    override fun onServiceConnected() {
        instancia = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            event.packageName?.toString()?.let { if (it != "com.android.systemui") appAtual = it }
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instancia === this) instancia = null
        super.onDestroy()
    }

    // ---------------------------------------------------------------- leitura
    fun protegido(): Boolean = Protecao.protegido(appAtual.ifBlank { rootInActiveWindow?.packageName?.toString() ?: "" })

    fun lerTela(): String {
        val raiz = rootInActiveWindow ?: return "Não consegui ler a tela agora."
        val pacote = raiz.packageName?.toString() ?: appAtual
        if (Protecao.protegido(pacote)) return "App protegido (${Protecao.nome(this, pacote)}): por segurança eu não leio nem mexo nesta tela. Peça ao usuário para fazer."
        val lista = mutableListOf<AccessibilityNodeInfo>()
        val linhas = mutableListOf<String>()
        fun visitar(n: AccessibilityNodeInfo?, prof: Int) {
            if (n == null || lista.size >= 180 || !n.isVisibleToUser) return
            val txt = (n.text ?: n.contentDescription ?: n.hintText)?.toString()?.replace("\n", " ")?.trim().orEmpty()
            val util = txt.isNotEmpty() || n.isClickable || n.isEditable || n.isScrollable || n.isCheckable
            if (util) {
                val r = Rect().also { n.getBoundsInScreen(it) }
                val tipo = when {
                    n.isEditable -> "campo"
                    n.isCheckable -> if (n.isChecked) "opção ✔" else "opção"
                    n.isClickable -> "botão"
                    n.isScrollable -> "lista rolável"
                    else -> "texto"
                }
                val conteudo = if (n.isPassword) "••••" else txt.take(120)
                linhas += "[${lista.size}] $tipo${if (conteudo.isNotEmpty()) ": \"$conteudo\"" else ""} (${r.centerX()},${r.centerY()})"
                lista += n
            }
            for (i in 0 until n.childCount) visitar(n.getChild(i), prof + 1)
        }
        visitar(raiz, 0)
        ultimaLista = lista
        return "App: ${Protecao.nome(this, pacote)} ($pacote)\n" + linhas.joinToString("\n") +
            "\n(Use o número entre colchetes em android_tocar/android_digitar.)"
    }

    // ---------------------------------------------------------------- ações
    private fun clicavel(n: AccessibilityNodeInfo): AccessibilityNodeInfo {
        var a: AccessibilityNodeInfo? = n
        while (a != null && !a.isClickable) a = a.parent
        return a ?: n
    }

    suspend fun tocar(indice: Int?, texto: String?, x: Int?, y: Int?, longo: Boolean): String {
        if (protegido()) return Protecao.MSG
        if (indice != null) {
            val n = ultimaLista.getOrNull(indice) ?: return "Elemento [$indice] não existe mais. Leia a tela de novo (android_tela)."
            val alvo = clicavel(n)
            if (alvo.performAction(if (longo) AccessibilityNodeInfo.ACTION_LONG_CLICK else AccessibilityNodeInfo.ACTION_CLICK)) return "Toquei em [$indice]."
            val r = Rect().also { n.getBoundsInScreen(it) }
            return gesto(r.centerX().toFloat(), r.centerY().toFloat(), longo)
        }
        if (!texto.isNullOrBlank()) {
            val raiz = rootInActiveWindow ?: return "Não consegui ler a tela."
            val achados = raiz.findAccessibilityNodeInfosByText(texto).filter { it.isVisibleToUser }
            val n = achados.firstOrNull() ?: return "Não achei \"$texto\" na tela."
            clicavel(n).performAction(if (longo) AccessibilityNodeInfo.ACTION_LONG_CLICK else AccessibilityNodeInfo.ACTION_CLICK)
            return "Toquei em \"$texto\"."
        }
        if (x != null && y != null) return gesto(x.toFloat(), y.toFloat(), longo)
        return "Diga onde tocar (índice, texto ou coordenadas)."
    }

    private suspend fun gesto(x: Float, y: Float, longo: Boolean): String {
        val p = Path().apply { moveTo(x, y) }
        val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, if (longo) 700 else 60)).build()
        return if (despachar(g)) "Toquei em ($x, $y)." else "O toque não foi aceito."
    }

    private suspend fun despachar(g: GestureDescription): Boolean = suspendCancellableCoroutine { c ->
        val ok = dispatchGesture(g, object : GestureResultCallback() {
            override fun onCompleted(d: GestureDescription?) { if (c.isActive) c.resume(true) }
            override fun onCancelled(d: GestureDescription?) { if (c.isActive) c.resume(false) }
        }, null)
        if (!ok && c.isActive) c.resume(false)
    }

    fun digitar(texto: String, indice: Int?): String {
        if (protegido()) return Protecao.MSG
        val alvo = indice?.let { ultimaLista.getOrNull(it) } ?: rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: return "Nenhum campo selecionado. Toque no campo antes (android_tocar)."
        if (alvo.isPassword) return "É um campo de senha: por segurança, peça ao usuário para digitar."
        alvo.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, texto) }
        return if (alvo.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) "Digitei o texto." else "O campo não aceitou o texto."
    }

    suspend fun rolar(direcao: String): String {
        if (protegido()) return Protecao.MSG
        val raiz = rootInActiveWindow ?: return "Não consegui ler a tela."
        fun achar(n: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
            if (n == null) return null
            if (n.isScrollable && n.isVisibleToUser) return n
            for (i in 0 until n.childCount) achar(n.getChild(i))?.let { return it }
            return null
        }
        val baixo = direcao in listOf("baixo", "down", "frente")
        achar(raiz)?.let {
            if (it.performAction(if (baixo) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) return "Rolei para ${if (baixo) "baixo" else "cima"}."
        }
        val m = resources.displayMetrics
        val x = m.widthPixels / 2f
        val (y1, y2) = if (baixo) m.heightPixels * 0.75f to m.heightPixels * 0.3f else m.heightPixels * 0.3f to m.heightPixels * 0.75f
        val p = Path().apply { moveTo(x, y1); lineTo(x, y2) }
        return if (despachar(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, 350)).build())) "Rolei." else "Não consegui rolar."
    }

    fun navegar(acao: String): String {
        val g = when (acao) {
            "voltar" -> GLOBAL_ACTION_BACK
            "inicio" -> GLOBAL_ACTION_HOME
            "recentes" -> GLOBAL_ACTION_RECENTS
            "notificacoes" -> GLOBAL_ACTION_NOTIFICATIONS
            "configuracoes_rapidas" -> GLOBAL_ACTION_QUICK_SETTINGS
            else -> return "Ação desconhecida: $acao"
        }
        return if (performGlobalAction(g)) "Feito: $acao." else "Não consegui: $acao."
    }

    suspend fun print(): Pair<String, String?> {
        if (protegido()) return Protecao.MSG to null
        if (Build.VERSION.SDK_INT < 30) return "Print exige Android 11 ou mais novo." to null
        return suspendCancellableCoroutine { c ->
            takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
                override fun onSuccess(r: ScreenshotResult) {
                    val hw = Bitmap.wrapHardwareBuffer(r.hardwareBuffer, r.colorSpace)
                    val bmp = hw?.copy(Bitmap.Config.ARGB_8888, false)
                    r.hardwareBuffer.close()
                    if (bmp == null) {
                        if (c.isActive) c.resume("Não consegui tirar o print." to null)
                        return
                    }
                    val escala = 720f / bmp.width
                    val menor = Bitmap.createScaledBitmap(bmp, 720, (bmp.height * escala).toInt(), true)
                    val out = ByteArrayOutputStream()
                    menor.compress(Bitmap.CompressFormat.JPEG, 70, out)
                    if (c.isActive) c.resume("Print da tela do celular (720px de largura; coordenadas x/y em pixels reais = valor do print / ${"%.3f".format(escala)})." to Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
                }
                override fun onFailure(code: Int) {
                    if (c.isActive) c.resume("Print bloqueado pelo app ou pelo sistema (código $code)." to null)
                }
            })
        }
    }

    companion object {
        @Volatile var instancia: TavinhoAcessibilidade? = null
    }
}

/** Apps de banco, carteiras e pagamento: o Tavinho sempre para e pede o usuário. */
object Protecao {
    const val MSG = "Este é um app protegido (banco, senha ou pagamento). Por segurança eu paro aqui: peça ao usuário para fazer esta parte."
    private val pacotes = listOf(
        "com.nu.production", "com.itau", "br.com.itau", "com.bradesco", "br.com.bradesco", "com.santander", "br.com.santander",
        "br.com.bb.android", "br.com.caixa", "br.gov.caixa", "br.com.intermedium", "com.picpay", "com.mercadopago", "com.c6bank",
        "br.com.original", "com.btgpactual", "com.xp", "br.com.xp", "com.google.android.apps.walletnfcrel", "com.paypal",
        "com.samsung.android.spay", "br.com.sicredi", "br.com.sicoob", "com.binance", "com.azul.pagamentos", "com.pagseguro",
        "br.com.uol.ps", "com.inter", "br.com.bancobrasil",
    )
    private val palavras = listOf("bank", "banco", "pay", "wallet", "carteira", "pix", "senha", "password", "authenticator", "1password", "bitwarden", "lastpass")

    fun protegido(pacote: String): Boolean {
        val p = pacote.lowercase()
        if (p.isBlank() || p.startsWith("br.com.dommasistemas")) return false
        return pacotes.any { p.startsWith(it) } || palavras.any { p.contains(it) }
    }

    fun nome(ctx: android.content.Context, pacote: String): String =
        runCatching { ctx.packageManager.getApplicationLabel(ctx.packageManager.getApplicationInfo(pacote, 0)).toString() }.getOrDefault(pacote)
}
