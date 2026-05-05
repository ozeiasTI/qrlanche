npx create-expo-app E-lanche--template blank
cd E-lanche
_____________________________________________________________
# Navegação
npx expo install react-native-screens react-native-safe-area-context
npm install @react-navigation/native @react-navigation/native-stack

# Câmera
npx expo install expo-camera

# Banco de dados
npx expo install expo-sqlite

# Picker
npm install @react-native-picker/picker

# Compartilhamento
npx expo install expo-sharing

# Sistema de arquivos
npx expo install expo-file-system

# Base64
npm install base-64

# PDF
npm install pdf-lib

# Document Picker
npx expo install expo-document-picker

# Excel
npm install xlsx

______________________________________________________________________________

App.js: 

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, FlatList, Platform } from 'react-native';
import { NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as SQLite from 'expo-sqlite';
import { Picker } from '@react-native-picker/picker';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { encode as btoa } from 'base-64';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as DocumentPicker from 'expo-document-picker';
import * as XLSX from 'xlsx';

const Stack = createNativeStackNavigator();
let db;

async function initDatabase(setReady) {
  db = await SQLite.openDatabaseAsync('leitor.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS registros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessao TEXT,
      codigo TEXT,
      datahora TEXT
    );
    CREATE TABLE IF NOT EXISTS alunos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matricula TEXT UNIQUE NOT NULL,
      nome TEXT,
      curso TEXT
    );
  `);
  setReady(true);
}

// 🏠 Tela inicial
function HomeScreen({ navigation }) {
  const [sessionName, setSessionName] = useState('');
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    initDatabase(setDbReady);
  }, []);

  if (!dbReady) {
    return (
      <View style={styles.container}>
        <Text>Inicializando banco de dados...</Text>
      </View>
    );
  }

  const clearDatabase = async () => {
    Alert.alert(
      'Confirmar Limpeza',
      'Tem certeza que deseja limpar todos os registros de leitura?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar', onPress: async () => {
            await db.runAsync('DELETE FROM registros;');
            Alert.alert('Banco de dados de registros limpo!');
          }
        },
      ],
      { cancelable: true }
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Digite o nome da leitura:</Text>
      <TextInput
        style={styles.input}
        placeholder="Ex: Tarde 01/02"
        value={sessionName}
        onChangeText={setSessionName}
      />
      <Button
        title="Iniciar leitura"
        onPress={() => {
          if (sessionName.trim() === '') {
            Alert.alert('Informe um nome!');
          } else {
            navigation.navigate('Scanner', { sessionName });
          }
        }}
      />
      <View style={{ marginTop: 20 }}>
        <Button title="Ver histórico" onPress={() => navigation.navigate('History')} />
      </View>
      <View style={{ marginTop: 20 }}>
        <Button title="Gerenciar Alunos" onPress={() => navigation.navigate('ManageStudents')} />
      </View>
      <View style={{ marginTop: 20 }}>
        <Button title="Como usar o app" onPress={() => navigation.navigate('Help')} />
      </View>
      <View style={{ marginTop: 120 }}>
        <Button title="Limpar registros" color="red" onPress={clearDatabase} />
      </View>
      <View style={{ marginTop: 40, alignItems: 'center' }}>
        <Text style={{ fontSize: 14, color: '#666' }}>Desenvolvido por Ozeias Meira Santos de Souza</Text>
      </View>
    </View>
  );
}

// 📷 Tela de leitura
function ScannerScreen({ route, navigation }) {
  const { sessionName } = route.params;
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', color: '' });
  const [count, setCount] = useState(0);

  const loadCount = async () => {
    try {
      const registros = await db.getAllAsync(
        'SELECT COUNT(*) as total FROM registros WHERE sessao = ?;',
        [sessionName]
      );
      setCount(registros[0].total);
    } catch (err) {
      console.error('Erro ao carregar contador:', err);
    }
  };

  useEffect(() => {
    loadCount();
  }, []);

  if (!permission) return <View />;
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={{ textAlign: 'center' }}>Permissão da câmera necessária</Text>
        <Button title="Conceder permissão" onPress={requestPermission} />
      </View>
    );
  }

  const handleBarCodeScanned = async ({ data }) => {
    setScanned(true);

    try {
      const aluno = await db.getFirstAsync(
        'SELECT * FROM alunos WHERE matricula = ?;',
        [data.toString()]
      );

      if (!aluno) {
        setFeedback({ message: `não cadastrado!`, color: '#FF5555' });
        Alert.alert('Erro', `Matrícula '${data}' não encontrada no cadastro.`);
      } else {
        const duplicados = await db.getAllAsync(
          'SELECT * FROM registros WHERE sessao = ? AND codigo = ?;',
          [sessionName, data]
        );

        if (duplicados.length > 0) {
          setFeedback({ message: `⚠️ Já pegou`, color: '#990000' });
        } else {
          await db.runAsync(
            'INSERT INTO registros (sessao, codigo, datahora) VALUES (?, ?, datetime("now", "localtime"));',
            [sessionName, data]
          );
          setFeedback({ message: `✅ registrado com sucesso!`, color: '#4CAF50' });
          loadCount();
        }
      }
    } catch (err) {
      console.error('Erro ao salvar leitura ou verificar matrícula:', err);
      setFeedback({ message: '⚠️ Ocorreu um erro ao registrar!', color: '#FF5555' });
    }

    // limpa feedback após 3s
    setTimeout(() => {
      setFeedback({ message: '', color: '' });
      setScanned(false);
    }, 3000);
  };

  return (
    <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
      {/* Feedback textual visível */}
      {feedback.message !== '' && (
        <View style={[styles.feedbackTop, { backgroundColor: feedback.color }]}>
          <Text style={styles.feedbackText}>{feedback.message}</Text>
        </View>
      )}

      {/* Área da câmera */}
      <View style={styles.cameraBox}>
        <CameraView
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          style={styles.cameraView}
        />
      </View>

      {/* Rodapé com sessão e contador */}
      <View style={styles.overlay}>
        <Text style={styles.sessionTitle}>Sessão: {sessionName}</Text>
        <Text style={styles.counterText}>📊 Registros: {count}</Text>
        <Button title="Encerrar leitura" onPress={() => navigation.goBack()} />
      </View>
    </View>
  );
}

// 📜 Tela de histórico
function HistoryScreen() {
  const [records, setRecords] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState('todas');

  const loadSessions = async () => {
    const s = await db.getAllAsync('SELECT DISTINCT sessao FROM registros;');
    setSessions(s.map((item) => item.sessao));
  };

  const loadData = async (sessao = 'todas') => {
    let data;
    if (sessao === 'todas') {
      data = await db.getAllAsync('SELECT * FROM registros ORDER BY sessao, id DESC;');
    } else {
      data = await db.getAllAsync(
        'SELECT * FROM registros WHERE sessao = ? ORDER BY id DESC;',
        [sessao]
      );
    }
    setRecords(data);
  };

  useEffect(() => {
    loadSessions();
    loadData();
  }, []);

  useEffect(() => {
    loadData(selectedSession);
  }, [selectedSession]);

  const exportPDF = async () => {
    if (records.length === 0) {
      alert('Nenhum registro para exportar!');
      return;
    }

    try {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      let y = height - 40;

      // Título
      page.drawText(' Histórico de Leituras', { x: 50, y, size: 20, font, color: rgb(0, 0, 0) });
      y -= 30;

      // Total de registros
      page.drawText(`Total de registros: ${records.length}`, { x: 50, y, size: 14, font, color: rgb(0, 0, 0) });
      y -= 25;

      // Cabeçalho
      page.drawText('Sessão', { x: 50, y, size: 12, font, color: rgb(0, 0, 1) });
      page.drawText('Código', { x: 150, y, size: 12, font, color: rgb(0, 0, 1) });
      page.drawText('Data/Hora', { x: 300, y, size: 12, font, color: rgb(0, 0, 1) });
      y -= 18
      // Linhas com cores alternadas
      let rowColor = false;
      records.forEach((item) => {
        // Fundo da linha (opcional)
        if (rowColor) {
          page.drawRectangle({ x: 45, y: y - 2, width: width - 90, height: 16, color: rgb(0.95, 0.95, 0.95) });
        }
        rowColor = !rowColor;

        // Texto da linha
        page.drawText(item.sessao, { x: 50, y, size: 12, font, color: rgb(0, 0, 0) });
        page.drawText(item.codigo, { x: 150, y, size: 12, font, color: rgb(0, 0, 0) });
        page.drawText(item.datahora, { x: 300, y, size: 12, font, color: rgb(0, 0, 0) });
        y -= 18;

        if (y < 40) {
          y = height - 40;
          pdfDoc.addPage();
        }
      });

      // Salvar PDF
      const pdfBytes = await pdfDoc.save();

      // Converter para Base64 corretamente
      let binary = '';
      const bytes = new Uint8Array(pdfBytes);
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
      }

      const base64Data = btoa(binary);

      const fileUri = FileSystem.documentDirectory + 'historico.pdf';
      await FileSystem.writeAsStringAsync(fileUri, base64Data, { encoding: 'base64' });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { mimeType: 'application/pdf', dialogTitle: 'Compartilhar PDF' });
      } else {
        alert('Compartilhamento não disponível.\nArquivo salvo em: ' + fileUri);
      }

    } catch (error) {
      console.error('Erro ao exportar PDF:', error);
      alert('Erro ao exportar PDF');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📋 Histórico de Leituras</Text>

      <View style={styles.filterContainer}>
        <Text style={styles.filterLabel}>Filtrar por sessão:</Text>
        <Picker
          selectedValue={selectedSession}
          style={styles.picker}
          onValueChange={(itemValue) => setSelectedSession(itemValue)}
        >
          <Picker.Item label="Todas" value="todas" />
          {sessions.map((s) => <Picker.Item key={s} label={s} value={s} />)}
        </Picker>
      </View>

      <View style={{ marginVertical: 10 }}>
        <Button title="Exportar PDF" onPress={exportPDF} />
      </View>

      <Text style={styles.countText}>Total: {records.length} registros</Text>

      {records.length === 0 ? (
        <Text style={{ textAlign: 'center', marginTop: 20 }}>Nenhum registro encontrado.</Text>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item, index }) => (
            <View style={styles.listItem}>
              <Text style={styles.listIndex}>{index + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.listText}>Sessão: {item.sessao}</Text>
                <Text style={styles.listCode}>Código: {item.codigo}</Text>
                <Text style={styles.listDate}>📅 {item.datahora}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

// 🧑‍🎓 Tela de Gerenciamento de Alunos
function ManageStudentsScreen() {
  const [alunos, setAlunos] = useState([]);

  const loadAlunos = useCallback(async () => {
    try {
      const allAlunos = await db.getAllAsync('SELECT * FROM alunos ORDER BY nome;');
      setAlunos(allAlunos);
    } catch (err) {
      console.error('Erro ao carregar alunos:', err);
      Alert.alert('Erro', 'Não foi possível carregar os alunos.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAlunos();
    }, [loadAlunos])
  );

  const importStudents = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        copyToCacheDirectory: true,
      });

      if (res.canceled) {
        return;
      }

      const fileUri = res.assets[0].uri;
      const fileContent = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });

      const workbook = XLSX.read(fileContent, { type: 'base64' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet);

      if (json.length === 0) {
        Alert.alert('Erro', 'A planilha está vazia ou não contém dados válidos.');
        return;
      }

      // Assumindo que as colunas são 'matricula', 'nome', 'curso'
      // Você pode ajustar os nomes das colunas conforme sua planilha
      const insertPromises = json.map(async (row) => {
        // Detectar chaves com variação de nome
        const matricula =
          row.matricula || row.Matricula || row["Matrícula"]
            ? String(row.matricula || row.Matricula || row["Matrícula"]).trim()
            : null;

        const nome =
          row.nome || row.Nome
            ? String(row.nome || row.Nome).trim()
            : null;

        const curso =
          row.curso || row.Curso
            ? String(row.curso || row.Curso).trim()
            : '';

        if (matricula && nome) {
          try {
            await db.runAsync(
              'INSERT INTO alunos (matricula, nome, curso) VALUES (?, ?, ?) ON CONFLICT(matricula) DO UPDATE SET nome = excluded.nome, curso = excluded.curso;',
              [matricula, nome, curso]
            );
          } catch (insertErr) {
            console.warn(`Erro ao inserir/atualizar aluno ${matricula}:`, insertErr);
          }
        } else {
          console.warn('Linha ignorada devido a dados ausentes: ', row);
        }
      });


      await Promise.all(insertPromises);
      Alert.alert('Sucesso', `${json.length} alunos importados/atualizados com sucesso!`);
      loadAlunos(); // Recarregar a lista de alunos após a importação

    } catch (error) {
      console.error('Erro ao importar alunos:', error);
      Alert.alert('Erro', 'Não foi possível importar os alunos da planilha. Verifique o formato e as colunas (matricula, nome, curso).');
    }
  };

  const clearStudents = async () => {
    Alert.alert(
      'Confirmar Limpeza',
      'Tem certeza que deseja limpar todos os dados de alunos?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar', onPress: async () => {
            await db.runAsync('DELETE FROM alunos;');
            Alert.alert('Tabela de alunos limpa!');
            loadAlunos(); // Recarregar a lista de alunos
          }
        },
      ],
      { cancelable: true }
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🧑‍🎓 Gerenciar Alunos</Text>

      <View style={{ marginVertical: 10 }}>
        <Button title="Importar Alunos (Planilha .xls/.xlsx)" onPress={importStudents} />
      </View>
      <View style={{ marginVertical: 10 }}>
        <Button title="Limpar Tabela de Alunos" color="red" onPress={clearStudents} />
      </View>

      <Text style={styles.countText}>Total de Alunos: {alunos.length}</Text>

      {alunos.length === 0 ? (
        <Text style={{ textAlign: 'center', marginTop: 20 }}>Nenhum aluno cadastrado.</Text>
      ) : (
        <FlatList
          data={alunos}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <View style={styles.listItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listText}>Matrícula: {item.matricula}</Text>
                <Text style={styles.listCode}>Nome: {item.nome}</Text>
                {item.curso && <Text style={styles.listDate}>Curso: {item.curso}</Text>}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

// ℹ️ Tela de Ajuda / Como usar o App
function HelpScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>ℹ️ Como usar o QR Lanche</Text>

      <Text style={styles.helpText}>
        1️⃣ Na tela inicial, digite o nome da sessão (ex: Manhã 10/02).
      </Text>

      <Text style={styles.helpText}>
        2️⃣ Toque em "Iniciar leitura" para abrir a câmera.
      </Text>

      <Text style={styles.helpText}>
        3️⃣ Aponte para o QR Code do aluno.
      </Text>

      <Text style={styles.helpText}>
        4️⃣ Se o aluno estiver cadastrado, o registro será salvo automaticamente.
      </Text>

      <Text style={styles.helpText}>
        5️⃣ Use o histórico para visualizar ou exportar os dados.
      </Text>

      <Text style={[styles.helpText, { marginTop: 20 }]}>
        ⚠️ Importante: os alunos devem ser importados antes pela opção "Gerenciar Alunos".
      </Text>

      <Text style={[styles.helpText, { marginTop: 20 }]}>
        ⚠️ Importante: A planilha deve ser importada exatamente com o formato do SUAP [ ENSINO -- ALUNOS E PROFESORES -- ALUNOS ]
      </Text>
    </View>
  );
}


// 🚀 App principal
export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'QR Lanche' }} />
        <Stack.Screen name="Scanner" component={ScannerScreen} options={{ title: 'Leitura' }} />
        <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Histórico' }} />
        <Stack.Screen name="ManageStudents" component={ManageStudentsScreen} options={{ title: 'Gerenciar Alunos' }} />
        <Stack.Screen name="Help" component={HelpScreen} options={{ title: 'Como usar o app' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// 🎨 Estilos
const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f2f2f2' },
  label: { fontSize: 16, marginBottom: 5 },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 8, padding: 10, marginBottom: 10, backgroundColor: '#fff' },
  overlay: { position: 'absolute', bottom: 40, left: 20, right: 20, backgroundColor: '#00000099', padding: 15, borderRadius: 10, alignItems: 'center' },
  sessionTitle: { color: '#fff', fontSize: 30, marginBottom: 10 },
  feedbackBox: { padding: 20, borderRadius: 10, marginBottom: 15 },
  feedbackText: { fontSize: 22, color: '#fff', textAlign: 'center', fontWeight: 'bold' },
  title: { fontSize: 20, textAlign: 'center', marginBottom: 20, fontWeight: 'bold' },
  filterContainer: { marginBottom: 10 },
  filterLabel: { fontSize: 14, marginBottom: 5 },
  picker: { backgroundColor: '#fff', borderRadius: 8 },
  countText: { textAlign: 'center', marginBottom: 10, fontWeight: 'bold' },
  listItem: { flexDirection: 'row', backgroundColor: '#fff', padding: 10, marginBottom: 10, borderRadius: 8, borderLeftWidth: 5, borderLeftColor: '#4CAF50' },
  listIndex: { fontSize: 18, fontWeight: 'bold', marginRight: 10 },
  listText: { fontSize: 16, fontWeight: 'bold' },
  listCode: { fontSize: 14, color: '#333' },
  listDate: { fontSize: 12, color: '#555' },
  cameraBox: {
    width: 300,
    height: 300,
    borderWidth: 4,
    borderColor: '#000',
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  cameraView: {
    width: '100%',
    height: '100%',
  },
  counterText: {
    color: '#fff',
    fontSize: 25,
    marginBottom: 10,
    fontWeight: 'bold',
  },
  feedbackTop: {
    position: 'absolute',
    top: 40,
    left: 20,
    right: 20,
    padding: 40,
    borderRadius: 10,
    alignItems: 'center',
    zIndex: 10,
    elevation: 10,
  },
  feedbackText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    transform: [{ rotate: '180deg' }]
  },
  helpText: {
  fontSize: 16,
  marginBottom: 10,
  color: '#333',
  lineHeight: 22,
},

});

___________________________________________________________________
npx expo start --tunnel
eas login
eas build:configure
eas build -p android --profile preview