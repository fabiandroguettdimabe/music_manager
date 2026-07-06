# kotlinx.serialization — conserva los serializadores generados.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class cl.dimabe.noir.data.net.** {
    *** Companion;
}
-keepclasseswithmembers class cl.dimabe.noir.data.net.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class cl.dimabe.noir.data.net.**$$serializer { *; }

# Retrofit / OkHttp
-keepattributes Signature, Exceptions
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
