plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val versao = "0.3.1"

android {
    namespace = "br.com.dommasistemas.tavinho"
    compileSdk = 35

    defaultConfig {
        applicationId = "br.com.dommasistemas.tavinho"
        minSdk = 26
        targetSdk = 35
        versionCode = 301
        versionName = versao
    }

    // Assinatura do APK de distribuição: a chave NUNCA fica no repositório.
    // Vem das variáveis TAVINHO_KEYSTORE (caminho do .jks) e TAVINHO_KEYSTORE_SENHA
    // (no GitHub Actions: segredos ANDROID_KEYSTORE_B64 e ANDROID_KEYSTORE_SENHA).
    val keystore = System.getenv("TAVINHO_KEYSTORE")
    val senhaKeystore = System.getenv("TAVINHO_KEYSTORE_SENHA")
    signingConfigs {
        if (!keystore.isNullOrBlank() && !senhaKeystore.isNullOrBlank()) {
            create("distribuicao") {
                storeFile = file(keystore)
                storePassword = senhaKeystore
                keyAlias = System.getenv("TAVINHO_KEY_ALIAS") ?: "tavinho"
                keyPassword = senhaKeystore
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Sem a chave, o APK release sai sem assinatura (não instala) — o CI falha antes disso.
            signingConfigs.findByName("distribuicao")?.let { signingConfig = it }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val bom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(bom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.security:security-crypto:1.0.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
