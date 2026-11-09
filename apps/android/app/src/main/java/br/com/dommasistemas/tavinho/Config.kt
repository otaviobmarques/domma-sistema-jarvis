package br.com.dommasistemas.tavinho

import android.content.Context
import android.os.Build
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

/** Configuração local. O token do dispositivo fica criptografado (Android Keystore). */
class Config(ctx: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        "tavinho_config",
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        ctx,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var servidor: String
        get() = prefs.getString("servidor", null) ?: SERVIDOR_PADRAO
        set(v) = prefs.edit().putString("servidor", v.trimEnd('/')).apply()
    var token: String?
        get() = prefs.getString("token", null)
        set(v) = prefs.edit().putString("token", v).apply()
    var deviceId: String?
        get() = prefs.getString("device_id", null)
        set(v) = prefs.edit().putString("device_id", v).apply()
    var usuario: String?
        get() = prefs.getString("usuario", null)
        set(v) = prefs.edit().putString("usuario", v).apply()
    var nomeAssistente: String
        get() = prefs.getString("nome_assistente", null) ?: "Tavinho"
        set(v) = prefs.edit().putString("nome_assistente", v).apply()
    var falarRespostas: Boolean
        get() = prefs.getBoolean("falar", true)
        set(v) = prefs.edit().putBoolean("falar", v).apply()
    var velocidade: Float
        get() = prefs.getFloat("velocidade", 1.15f)
        set(v) = prefs.edit().putFloat("velocidade", v).apply()
    var onboardingFeito: Boolean
        get() = prefs.getBoolean("onboarding", false)
        set(v) = prefs.edit().putBoolean("onboarding", v).apply()

    val pareado get() = token != null && deviceId != null
    val nomeAparelho: String get() = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"

    fun desparear() {
        prefs.edit().remove("token").remove("device_id").remove("usuario").apply()
    }

    companion object {
        const val SERVIDOR_PADRAO = "https://jarvis.dommasistemas.com.br"
    }
}
