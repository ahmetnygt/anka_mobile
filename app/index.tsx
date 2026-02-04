import AsyncStorage from '@react-native-async-storage/async-storage';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as NavigationBar from 'expo-navigation-bar'; // <--- YENİ EKLENDİ
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

// --- TİPLER ---
interface ScannedData {
  tc: string; ad: string; soyad: string; yakinlik: string; rutbe: string; kuvvet: string;
}

const initialData: ScannedData = {
  tc: "", ad: "", soyad: "", yakinlik: "", rutbe: "", kuvvet: ""
};

// --- RENK PALETİ ---
const COLORS = {
  bg: "#121212",
  card: "#1E1E1E",
  primary: "#E59400",
  text: "#FFFFFF",
  subText: "#AAAAAA",
  border: "#333333",
  success: "#2ECC71",
  danger: "#E74C3C"
};

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<'CONNECT' | 'ON_YUZ' | 'ARKA_YUZ' | 'FORM'>('CONNECT');
  const [data, setData] = useState<ScannedData>(initialData);
  const [processing, setProcessing] = useState<boolean>(false);
  const cameraRef = useRef<CameraView>(null);
  const [ipAddress, setIpAddress] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    // 1. EKRANI YATAY KİLİTLE
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);

    // 2. ALT NAVİGASYON TUŞLARINI GİZLE (Android)
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync("hidden");
      NavigationBar.setBehaviorAsync("overlay-swipe"); // Kaydırınca geri gelir, sonra yine kaybolur
    }

    AsyncStorage.getItem('SAVED_IP').then(ip => { if (ip) setIpAddress(ip); });
  }, []);

  // --- İZİN KONTROL ---
  if (!permission) return <View style={{ flex: 1, backgroundColor: COLORS.bg }} />;
  if (!permission.granted) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar hidden /> 
        <Text style={styles.title}>KAMERA İZNİ GEREKLİ</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={requestPermission}>
          <Text style={styles.btnText}>İZİN VER</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- FONKSİYONLAR ---
  const handleConnect = async () => {
    if (!ipAddress) { Alert.alert("Hata", "Lütfen PC IP adresini giriniz."); return; }
    setIsConnecting(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`http://${ipAddress}:5000/receive-data`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ping: true }), signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        await AsyncStorage.setItem('SAVED_IP', ipAddress);
        setPhase('ON_YUZ');
      } else { Alert.alert("Hata", "Sunucuya ulaşılamadı."); }
    } catch (e) { Alert.alert("Hata", "Bağlantı kurulamadı."); }
    finally { setIsConnecting(false); }
  };

  const handleScan = async () => {
    if (cameraRef.current && !processing) {
      setProcessing(true);
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, base64: false, shutterSound: false });
        if (!photo) return;
        const result = await TextRecognition.recognize(photo.uri);
        const sortedBlocks = result.blocks.sort((a, b) => (a.frame?.top ?? 0) - (b.frame?.top ?? 0));
        const sortedText = sortedBlocks.map(b => b.text).join('\n');
        
        if (phase === 'ON_YUZ') analyzeFront(sortedText);
        else if (phase === 'ARKA_YUZ') analyzeBack(sortedText);
      } catch (e) { Alert.alert("Hata", "Okuma başarısız."); }
      finally { setProcessing(false); }
    }
  };

  const cleanText = (raw: string) => raw.replace(/[^a-zA-ZçÇğĞıİöÖşŞüÜ\s]/g, '').trim().toLocaleUpperCase('tr-TR');

  const analyzeFront = (text: string) => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);
    let newData = { ...data };
    let foundTC = false;
    const tcMatch = text.match(/\b[1-9][0-9]{10}\b/);
    if (tcMatch) { newData.tc = tcMatch[0]; foundTC = true; }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(Ad|Name|Adr|Adt|Adi)/i.test(line) && !/(Soy|Last)/i.test(line)) if (lines[i + 1]) newData.ad = cleanText(lines[i + 1]);
      if (/(Soy|Last|oyad|oyąd)/i.test(line)) if (lines[i + 1] && lines[i + 1].length > 2) newData.soyad = cleanText(lines[i + 1]); else if (lines[i + 2]) newData.soyad = cleanText(lines[i + 2]);
      if (/(Yakın|Relation|ship)/i.test(line)) {
        let val = cleanText(line.replace(/(Yakınlığı|Relationship|:|Parent)/gi, ''));
        if (val.length > 2 && !val.includes("YAKIN")) newData.yakinlik = val;
        else if (lines[i + 1]) newData.yakinlik = cleanText(lines[i + 1]);
      }
    }
    if (/JANDARMA/i.test(text)) newData.kuvvet = "JANDARMA";
    
    if (foundTC) { 
        setData(newData); 
        Alert.alert("✅ ÖN YÜZ TAMAM", "Şimdi kartın arkasını çevirin.", [{ text: "DEVAM", onPress: () => setPhase('ARKA_YUZ') }]); 
    } else { Alert.alert("⚠️ Uyarı", "TC okunamadı."); }
  };

  const analyzeBack = (text: string) => {
    const lines = text.split('\n').map(l => l.trim());
    let newData = { ...data };
    let foundRutbe = false;
    if (!newData.kuvvet && /JANDARMA/i.test(text)) newData.kuvvet = "JANDARMA";
    for (const line of lines) if (/^(J\.|Uzm|Ast|Erb|Alb|Yzb|Bnb)/i.test(line) && line.length > 4) { newData.rutbe = cleanText(line); foundRutbe = true; break; }
    if (!foundRutbe) for (let i = 0; i < lines.length; i++) if (/(Sınıfı|Rütbe|Sinif)/i.test(lines[i])) { newData.rutbe = cleanText(lines[i + 1] || ""); break; }
    if (!newData.kuvvet && newData.rutbe && newData.rutbe.startsWith("J.")) newData.kuvvet = "JANDARMA";
    setData(newData);
    setPhase('FORM');
  };

  const handleSendToPC = async () => {
    setProcessing(true);
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`http://${ipAddress}:5000/receive-data`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data), signal: controller.signal
      });
      if (response.ok) { 
          Alert.alert("🚀 BAŞARILI", "Bilgisayara aktarıldı."); 
          setPhase('ON_YUZ'); setData(initialData); 
      } else { Alert.alert("❌ Hata", "Reddedildi."); }
    } catch (e) { Alert.alert("❌ Hata", "Bağlantı yok."); } 
    finally { setProcessing(false); }
  };

  const updateField = (key: keyof ScannedData, value: string) => setData(prev => ({ ...prev, [key]: value.toLocaleUpperCase('tr-TR') }));

  // --- EKRAN 1: BAĞLANTI ---
  if (phase === 'CONNECT') return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden /> 
      <View style={styles.splitLayout}>
        <View style={[styles.leftPane, { justifyContent: 'center', alignItems: 'flex-end', paddingRight: 40 }]}>
            <Text style={styles.logoText}>ANKA</Text>
            <Text style={styles.logoSub}>MOBİL TERMİNAL</Text>
        </View>
        <View style={[styles.rightPane, { justifyContent: 'center', paddingLeft: 40 }]}>
            <View style={styles.card}>
                <Text style={styles.label}>PC IP ADRESİ</Text>
                <TextInput 
                    style={styles.inputLarge} 
                    placeholder="192.168.1.XX" 
                    placeholderTextColor="#666" 
                    value={ipAddress} 
                    onChangeText={setIpAddress} 
                    keyboardType="url" 
                />
                <TouchableOpacity style={styles.btnPrimary} onPress={handleConnect} disabled={isConnecting}>
                    {isConnecting ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>BAĞLAN</Text>}
                </TouchableOpacity>
            </View>
        </View>
      </View>
    </SafeAreaView>
  );

  // --- EKRAN 2: KAMERA ---
  if (phase === 'ON_YUZ' || phase === 'ARKA_YUZ') return (
    <View style={styles.container}>
      <StatusBar hidden />
      <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 1, position: 'relative' }}>
            <CameraView style={{ flex: 1 }} facing="back" ref={cameraRef} />
            <View style={styles.overlay}>
                <View style={styles.scanFrameLandscape}>
                    <View style={styles.scanCornerTopLeft} />
                    <View style={styles.scanCornerTopRight} />
                    <View style={styles.scanCornerBottomLeft} />
                    <View style={styles.scanCornerBottomRight} />
                </View>
                <Text style={styles.phaseTitleOverlay}>{phase === 'ON_YUZ' ? "KİMLİK ÖN YÜZ" : "KİMLİK ARKA YÜZ"}</Text>
            </View>
          </View>
          <View style={styles.cameraControlsRight}>
             <TouchableOpacity style={styles.shutterBtn} onPress={handleScan} disabled={processing}>
                 {processing ? <ActivityIndicator size="large" color={COLORS.primary} /> : <View style={styles.shutterInner} />}
             </TouchableOpacity>
             <Text style={[styles.hintText, { marginTop: 10, textAlign: 'center' }]}>ÇEK</Text>
          </View>
      </View>
    </View>
  );

  // --- EKRAN 3: FORM ---
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden />
      <View style={styles.headerLandscape}>
        <Text style={styles.headerTitle}>VERİ KONTROLÜ</Text>
        <TouchableOpacity style={styles.btnSmallDanger} onPress={() => { setPhase('ON_YUZ'); setData(initialData); }}>
            <Text style={styles.btnTextSmall}>İPTAL</Text>
        </TouchableOpacity>
      </View>
      
      <ScrollView contentContainerStyle={styles.formContentLandscape}>
        <View style={styles.gridContainer}>
            <View style={styles.gridItem}>
                <InputRow label="TC KİMLİK NO" val={data.tc} setVal={t => updateField('tc', t)} />
            </View>
            <View style={styles.gridItem}>
                <InputRow label="RÜTBE" val={data.rutbe} setVal={t => updateField('rutbe', t)} />
            </View>
            <View style={styles.gridItem}>
                <InputRow label="AD" val={data.ad} setVal={t => updateField('ad', t)} />
            </View>
            <View style={styles.gridItem}>
                <InputRow label="SOYAD" val={data.soyad} setVal={t => updateField('soyad', t)} />
            </View>
            <View style={styles.gridItem}>
                <InputRow label="YAKINLIK" val={data.yakinlik} setVal={t => updateField('yakinlik', t)} />
            </View>
            <View style={styles.gridItem}>
                <InputRow label="BAĞLI KUVVET" val={data.kuvvet} setVal={t => updateField('kuvvet', t)} />
            </View>
        </View>

        <TouchableOpacity style={styles.btnPrimaryWide} onPress={handleSendToPC} disabled={processing}>
             {processing ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>💻 PC'YE AKTAR</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// --- YARDIMCI ---
const InputRow = ({ label, val, setVal }: { label: string, val: string, setVal: (t: string) => void }) => (
  <View style={{ marginBottom: 10 }}>
    <Text style={styles.label}>{label}</Text>
    <TextInput style={styles.input} value={val} onChangeText={setVal} placeholderTextColor="#444" />
  </View>
);

// --- STİLLER ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  splitLayout: { flex: 1, flexDirection: 'row' },
  leftPane: { flex: 1, backgroundColor: '#000' },
  rightPane: { flex: 1, backgroundColor: COLORS.bg },
  logoText: { fontSize: 60, fontWeight: '900', color: COLORS.primary, letterSpacing: 5 },
  logoSub: { fontSize: 16, color: COLORS.subText, letterSpacing: 2 },
  title: { color: COLORS.primary, fontSize: 24, fontWeight: 'bold' },
  card: { backgroundColor: COLORS.card, padding: 20, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, width: '90%' },
  label: { color: COLORS.subText, fontSize: 11, fontWeight: 'bold', marginBottom: 5, letterSpacing: 1 },
  input: { backgroundColor: '#121212', color: 'white', padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#333', fontSize: 14 },
  inputLarge: { backgroundColor: '#121212', color: COLORS.primary, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#333', fontSize: 18, textAlign: 'center', fontWeight: 'bold', marginBottom: 15 },
  btnPrimary: { backgroundColor: COLORS.primary, padding: 12, borderRadius: 8, alignItems: 'center' },
  btnPrimaryWide: { backgroundColor: COLORS.primary, padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10, marginBottom: 20 },
  btnSmallDanger: { backgroundColor: COLORS.danger, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 6 },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  btnTextSmall: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  scanFrameLandscape: { width: 400, height: 250, borderColor: 'transparent', position: 'relative' },
  scanCornerTopLeft: { position: 'absolute', top: 0, left: 0, width: 40, height: 40, borderTopWidth: 4, borderLeftWidth: 4, borderColor: COLORS.success },
  scanCornerTopRight: { position: 'absolute', top: 0, right: 0, width: 40, height: 40, borderTopWidth: 4, borderRightWidth: 4, borderColor: COLORS.success },
  scanCornerBottomLeft: { position: 'absolute', bottom: 0, left: 0, width: 40, height: 40, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: COLORS.success },
  scanCornerBottomRight: { position: 'absolute', bottom: 0, right: 0, width: 40, height: 40, borderBottomWidth: 4, borderRightWidth: 4, borderColor: COLORS.success },
  phaseTitleOverlay: { position: 'absolute', top: 20, backgroundColor: 'rgba(0,0,0,0.6)', color: COLORS.primary, fontWeight: 'bold', fontSize: 18, paddingHorizontal: 15, paddingVertical: 5, borderRadius: 10 },
  cameraControlsRight: { width: 100, backgroundColor: 'black', justifyContent: 'center', alignItems: 'center', borderLeftWidth: 1, borderLeftColor: '#333' },
  shutterBtn: { width: 70, height: 70, borderRadius: 35, borderWidth: 4, borderColor: 'white', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'white' },
  hintText: { color: '#888', fontSize: 12 },
  headerLandscape: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, backgroundColor: COLORS.card, borderBottomWidth: 1, borderBottomColor: '#333' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  formContentLandscape: { padding: 20 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridItem: { width: '48%', marginBottom: 10 },
});