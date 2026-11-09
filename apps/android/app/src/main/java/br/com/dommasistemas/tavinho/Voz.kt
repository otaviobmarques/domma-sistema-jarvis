package br.com.dommasistemas.tavinho

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.util.Locale

/** Gravação "segure para falar" (AAC 16 kHz mono, leve para enviar). */
class Gravador(private val ctx: Context) {
    private var rec: MediaRecorder? = null
    private val arquivo = File(ctx.cacheDir, "fala.m4a")

    fun iniciar() {
        parar()
        arquivo.delete()
        rec = (if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()).apply {
            setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioSamplingRate(16000)
            setAudioChannels(1)
            setAudioEncodingBitRate(32000)
            setOutputFile(arquivo.absolutePath)
            prepare()
            start()
        }
    }

    fun nivel(): Float = runCatching { (rec?.maxAmplitude ?: 0) / 12000f }.getOrDefault(0f).coerceIn(0f, 1f)

    /** Para e devolve o áudio em base64 (ou null se curto demais). */
    fun parar(): String? {
        val r = rec ?: return null
        rec = null
        runCatching { r.stop() }
        r.release()
        if (!arquivo.exists() || arquivo.length() < 2500) return null
        return Base64.encodeToString(arquivo.readBytes(), Base64.NO_WRAP)
    }
}

/** Fala frase a frase: ElevenLabs (voz natural, se configurada) ou a voz do Android. */
class Falador(private val ctx: Context) {
    private val escopo = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var tts: TextToSpeech? = null
    private var ttsPronto = false
    private val fila = Channel<Pair<String, Deferred<JSONObject?>>>(Channel.UNLIMITED)
    private var player: MediaPlayer? = null
    private var geracao = 0
    val falando = MutableStateFlow(false)

    init {
        tts = TextToSpeech(ctx) { st ->
            if (st == TextToSpeech.SUCCESS) {
                tts?.language = Locale("pt", "BR")
                ttsPronto = true
            }
        }
        escopo.launch { processar() }
    }

    fun falar(frase: String) {
        val cfg = TavinhoApp.instancia.config
        if (!cfg.falarRespostas || frase.isBlank()) return
        val vel = cfg.velocidade.coerceIn(0.7f, 1.2f)
        // já pede o áudio natural desta frase enquanto a anterior toca
        val audio = escopo.async(Dispatchers.IO) {
            runCatching { TavinhoApp.instancia.api().post("/device/tts", JSONObject().put("texto", frase).put("velocidade", vel.toDouble()), 30) }.getOrNull()
        }
        fila.trySend(frase to audio)
    }

    fun parar() {
        geracao++
        while (fila.tryReceive().isSuccess) Unit
        player?.runCatching { stop(); release() }
        player = null
        tts?.stop()
        falando.value = false
    }

    private suspend fun processar() {
        for ((frase, audio) in fila) {
            val g = geracao
            falando.value = true
            val r = audio.await()
            if (g != geracao) continue
            val b64 = r?.optString("audio")?.takeIf { it.isNotBlank() && it != "null" }
            if (b64 != null) tocar(b64, g) else falarAndroid(frase, g)
            if (fila.isEmpty) falando.value = false
        }
    }

    private suspend fun tocar(b64: String, g: Int) {
        val f = File(ctx.cacheDir, "resposta_$g.mp3").apply { writeBytes(Base64.decode(b64, Base64.DEFAULT)) }
        val fim = CompletableDeferred<Unit>()
        player = MediaPlayer().apply {
            setDataSource(f.absolutePath)
            setOnCompletionListener { fim.complete(Unit) }
            setOnErrorListener { _, _, _ -> fim.complete(Unit); true }
            prepare()
            start()
        }
        fim.await()
        player?.release()
        player = null
    }

    private suspend fun falarAndroid(frase: String, g: Int) {
        if (!ttsPronto || g != geracao) return
        val fim = CompletableDeferred<Unit>()
        tts?.setSpeechRate(TavinhoApp.instancia.config.velocidade + 0.1f)
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) { fim.complete(Unit) }
            @Deprecated("Deprecated in Java") override fun onError(id: String?) { fim.complete(Unit) }
            override fun onError(id: String?, code: Int) { fim.complete(Unit) }
        })
        tts?.speak(frase.replace("*", ""), TextToSpeech.QUEUE_ADD, null, "f$g-${frase.hashCode()}")
        fim.await()
    }

    fun fechar() {
        parar()
        tts?.shutdown()
    }
}

/** Divide o texto que chega em streaming em frases completas. */
class Frases(private val aoFrase: (String) -> Unit) {
    private val buf = StringBuilder()
    private val regex = Regex("^([\\s\\S]{12,}?[.!?…:](?=\\s)|[^\\n]{3,}\\n)")

    fun adicionar(d: String) {
        buf.append(d)
        while (true) {
            val m = regex.find(buf) ?: break
            aoFrase(m.groupValues[1].trim())
            buf.delete(0, m.groupValues[1].length)
        }
    }

    fun terminar() {
        val resto = buf.toString().trim()
        if (resto.isNotEmpty()) aoFrase(resto)
        buf.clear()
    }
}
