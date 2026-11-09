plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val versao = "0.3.0"

android {
    namespace = "br.com.dommasistemas.tavinho"
    compileSdk = 35

    defaultConfig {
        applicationId = "br.com.dommasistemas.tavinho"
        minSdk = 26
        targetSdk = 35
        versionCode = 300
        versionName = versao
    }

    // Distribuição interna (APK fora da Play Store): chave do projeto.
    signingConfigs {
        create("interna") {
            storeFile = file("../keystore/tavinho-interno.jks")
            storePassword = "tavinho-domma"
            keyAlias = "tavinho"
            keyPassword = "tavinho-domma"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("interna")
        }
        debug { signingConfig = signingConfigs.getByName("interna") }
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
