import { CameraView, useCameraPermissions } from 'expo-camera';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font } from '@/src/theme';

export function QrScanner({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const [permission, request] = useCameraPermissions();

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Scan a setup code</Text>
      <Text style={styles.body}>The code can carry the server URL only. Yume ignores any API key in the code.</Text>
      {permission?.granted ? (
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(event) => onScan(event.data)}
        />
      ) : (
        <Pressable style={styles.big} onPress={() => void request()}>
          <Text style={styles.bigText}>{permission?.canAskAgain === false ? 'Camera is blocked' : 'Allow the camera'}</Text>
        </Pressable>
      )}
      <Pressable style={styles.secondary} onPress={onClose}>
        <Text style={styles.secondaryText}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  title: { color: colors.text, fontFamily: font.black, fontSize: 22 },
  body: { color: colors.muted, fontFamily: font.semibold, fontSize: 15, lineHeight: 22 },
  camera: { height: 280, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.ink },
  big: { backgroundColor: colors.sakura, borderRadius: 18, paddingVertical: 18, alignItems: 'center' },
  bigText: { color: '#fff', fontFamily: font.black, fontSize: 18 },
  secondary: { borderRadius: 18, borderWidth: 1, borderColor: colors.line, paddingVertical: 16, alignItems: 'center' },
  secondaryText: { color: colors.text, fontFamily: font.black, fontSize: 16 },
});
