package br.com.dommasistemas.tavinho

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ErroApi(msg: String, val status: Int = 0) : Exception(msg)

/** Cliente das rotas device do cérebro. */
class Api(private val servidor: String, private val token: String?) {
    private val json = "application/json; charset=utf-8".toMediaType()

    private fun req(caminho: String) = Request.Builder().url(servidor.trimEnd('/') + caminho).apply {
        token?.let { header("Authorization", "Bearer $it") }
        header("User-Agent", "TavinhoAndroid/${BuildConfig.VERSION_NAME}")
    }

    private fun erro(codigo: Int, corpo: String?): ErroApi {
        val msg = runCatching { JSONObject(corpo ?: "{}").optString("error") }.getOrNull()
        return ErroApi(if (msg.isNullOrBlank()) "servidor respondeu $codigo" else msg, codigo)
    }

    suspend fun post(caminho: String, corpo: JSONObject = JSONObject(), timeoutS: Long = 120): JSONObject = withContext(Dispatchers.IO) {
        val c = cliente.newBuilder().readTimeout(timeoutS, TimeUnit.SECONDS).build()
        c.newCall(req(caminho).post(corpo.toString().toRequestBody(json)).build()).execute().use { r ->
            val s = r.body?.string()
            if (!r.isSuccessful) throw erro(r.code, s)
            if (s.isNullOrBlank() || s == "null") JSONObject() else JSONObject(s)
        }
    }

    suspend fun get(caminho: String): JSONObject = withContext(Dispatchers.IO) {
        cliente.newCall(req(caminho).get().build()).execute().use { r ->
            val s = r.body?.string()
            if (!r.isSuccessful) throw erro(r.code, s)
            if (s.isNullOrBlank() || s == "null") JSONObject() else JSONObject(s)
        }
    }

    /** Resposta em tempo real: chama [aoTexto] a cada pedaço; devolve o evento final. */
    suspend fun chatStream(texto: String, voz: Boolean, aoTexto: (String) -> Unit): JSONObject = withContext(Dispatchers.IO) {
        val corpo = JSONObject().put("texto", texto).put("voz", voz).toString().toRequestBody(json)
        val c = cliente.newBuilder().readTimeout(600, TimeUnit.SECONDS).build()
        c.newCall(req("/device/chat-stream").post(corpo).build()).execute().use { r ->
            if (!r.isSuccessful) throw erro(r.code, r.body?.string())
            val fonte = r.body!!.source()
            var fim = JSONObject()
            while (!fonte.exhausted()) {
                val linha = fonte.readUtf8Line() ?: break
                if (linha.isBlank()) continue
                val v = runCatching { JSONObject(linha) }.getOrNull() ?: continue
                when (v.optString("t")) {
                    "delta" -> aoTexto(v.optString("texto"))
                    "fim" -> fim = v
                    "erro" -> throw ErroApi(v.optString("erro"))
                }
            }
            fim
        }
    }

    companion object {
        val cliente: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}
