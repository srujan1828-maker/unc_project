package dev.omnisync

import android.content.Context
import androidx.core.content.edit
import android.net.Uri
import android.provider.OpenableColumns
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SessionVault(private val context: Context) {
    private val preferences = context.getSharedPreferences("omnisync", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("omnisync.session", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("omnisync.session", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun save(origin: String, token: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()); updateAAD(origin.toByteArray()) }
        val encrypted = cipher.doFinal(token.toByteArray())
        preferences.edit {
            putString("origin", origin)
            putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            putString("token", Base64.encodeToString(encrypted, Base64.NO_WRAP))
        }
    }
    fun load(): OmniApi? {
        val origin = preferences.getString("origin", null) ?: return null
        val encrypted = preferences.getString("token", null) ?: return null
        val iv = preferences.getString("iv", null) ?: return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))); updateAAD(origin.toByteArray())
        }
        return OmniApi(origin, String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP))))
    }
}

class OmniApi(server: String, var token: String? = null) {
    val origin = server.trim().trimEnd('/')
    init {
        val uri = URI(origin)
        require(uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null && uri.path.isNullOrEmpty()) { "Enter only the workspace origin." }
        require(uri.scheme == "https" || (uri.scheme == "http" && uri.host in listOf("localhost", "127.0.0.1"))) { "Use HTTPS for connections outside localhost." }
    }
    private fun connection(path: String, method: String, bytes: ByteArray?, headers: Map<String, String>): HttpURLConnection {
        val c = URL("$origin/api$path").openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = 15000; c.readTimeout = 60000; c.instanceFollowRedirects = false
        c.setRequestProperty("X-Omni-Client", "1"); c.setRequestProperty("X-Omni-Cli", "1")
        token?.let { c.setRequestProperty("Authorization", "Bearer $it") }
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        if (bytes != null) { c.doOutput = true; c.setFixedLengthStreamingMode(bytes.size); c.outputStream.use { it.write(bytes) } }
        if (c.responseCode !in 200..299) {
            val error = c.errorStream?.bufferedReader()?.use { it.readText() }
            val message = runCatching { JSONObject(error ?: "{}").optString("error", "Workspace request failed.") }.getOrDefault("Workspace request failed.")
            c.disconnect(); throw IllegalStateException(message)
        }
        return c
    }
    fun json(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val c = connection(path, method, body?.toString()?.toByteArray(), mapOf("Content-Type" to "application/json"))
        return try { c.inputStream.bufferedReader().use { JSONObject(it.readText()) } } finally { c.disconnect() }
    }
    fun pair(code: String, name: String) {
        token = json("/join", "POST", JSONObject().put("name", name).put("code", code).put("platform", "Android")).getString("token")
    }
    fun share(text: String) { json("/clipboard", "POST", JSONObject().put("text", text)) }
    fun upload(context: Context, uri: Uri) {
        var name = "Shared file"
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) { val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME); if (column >= 0) name = cursor.getString(column) }
        }
        val temporary = File.createTempFile("omnisync-", ".upload", context.cacheDir)
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            val source = context.contentResolver.openInputStream(uri) ?: error("Cannot open this file.")
            source.use { input -> temporary.outputStream().use { output ->
                val buffer = ByteArray(1048576); var total = 0L
                while (true) { val count = input.read(buffer); if (count < 0) break; total += count; require(total <= 1073741824L) { "The file limit is 1 GB." }; digest.update(buffer, 0, count); output.write(buffer, 0, count) }
            } }
            val transfer = json("/transfers", "POST", JSONObject().put("name", name).put("size", temporary.length()).put("sha256", digest.digest().hex()))
            var offset = transfer.getLong("offset")
            java.io.RandomAccessFile(temporary, "r").use { file ->
                file.seek(offset); val buffer = ByteArray(1048576)
                while (true) {
                    val count = file.read(buffer); if (count < 0) break
                    val chunk = buffer.copyOf(count)
                    val c = connection("/transfers/${transfer.getString("id")}/chunk", "PUT", chunk, mapOf("Content-Type" to "application/octet-stream", "X-Offset" to offset.toString(), "X-Chunk-SHA256" to MessageDigest.getInstance("SHA-256").digest(chunk).hex()))
                    try { offset = c.inputStream.bufferedReader().use { JSONObject(it.readText()).getLong("offset") } } finally { c.disconnect() }
                }
            }
            json("/transfers/${transfer.getString("id")}/complete", "POST", JSONObject())
        } finally { temporary.delete() }
    }
    fun download(context: Context, transfer: JSONObject, uri: Uri) {
        val temporary = File.createTempFile("omnisync-", ".download", context.cacheDir)
        val c = connection("/transfers/${transfer.getString("id")}/download", "GET", null, emptyMap())
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            c.inputStream.use { input -> temporary.outputStream().use { output ->
                val buffer = ByteArray(1048576)
                while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count); output.write(buffer, 0, count) }
            } }
            check(digest.digest().hex() == transfer.getString("sha256")) { "Download checksum mismatch." }
            val output = context.contentResolver.openOutputStream(uri) ?: error("Cannot write to this location.")
            output.use { temporary.inputStream().use { input -> input.copyTo(it) } }
        } finally { c.disconnect(); temporary.delete() }
    }
}
private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }
