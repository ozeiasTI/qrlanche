import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, FlatList, Platform, ScrollView } from 'react-native';
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
  try {
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
  } catch (err) {
    console.error('Erro ao inicializar banco de dados:', err);
    Alert.alert('Erro', 'Falha ao inicializar o banco de dados. Reinicie o app.');
  }
}

// 🏠 Tela inicial
function HomeScreen({ navigation }) {
  const [sessionName, setSessionName] = useState('');

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
        <Button title="Central de Leituras" onPress={() => navigation.navigate('ReadingCenter')} />
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
  const [isCoolingDown, setIsCoolingDown] = useState(false);
  const [feedback, setFeedback] = useState({ message: 'Pronto', color: '#2E7D32', textColor: '#fff' });
  const [count, setCount] = useState(0);
  const [countTecnico, setCountTecnico] = useState(0);
  const [countSuperior, setCountSuperior] = useState(0);
  const cooldownTimerRef = useRef(null);
  const COOLDOWN_MS = 1500; // Reduzido para ser mais rápido conforme solicitado

  const loadCounts = async () => {
    try {
      const totalRes = await db.getAllAsync(
        'SELECT COUNT(*) as total FROM registros WHERE sessao = ?;',
        [sessionName]
      );
      setCount(totalRes[0].total);

      const countsRes = await db.getAllAsync(
        `SELECT 
          SUM(CASE WHEN a.curso LIKE '0403%' THEN 1 ELSE 0 END) as tecnico,
          SUM(CASE WHEN a.curso NOT LIKE '0403%' THEN 1 ELSE 0 END) as superior
         FROM registros r
         JOIN alunos a ON r.codigo = a.matricula
         WHERE r.sessao = ?;`,
        [sessionName]
      );
      
      setCountTecnico(countsRes[0].tecnico || 0);
      setCountSuperior(countsRes[0].superior || 0);
    } catch (err) {
      console.error('Erro ao carregar contadores:', err);
    }
  };

  useEffect(() => {
    loadCounts();

    return () => {
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
      }
    };
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
    if (scanned || isCoolingDown) return;

    setScanned(true);
    setFeedback({ message: 'Aguarde', color: '#FFD400', textColor: '#1F1F1F' });

    try {
      const aluno = await db.getFirstAsync(
        'SELECT * FROM alunos WHERE matricula = ?;',
        [data.toString()]
      );

      if (!aluno) {
        setFeedback({ message: 'Não cadastrado!', color: '#FF5555', textColor: '#fff' });
        Alert.alert('Erro', `Matrícula '${data}' não encontrada no cadastro.`);
      } else {
        const duplicados = await db.getAllAsync(
          'SELECT * FROM registros WHERE sessao = ? AND codigo = ?;',
          [sessionName, data]
        );

        if (duplicados.length > 0) {
          setFeedback({ message: '⚠️ Já pegou', color: '#990000', textColor: '#fff' });
        } else {
          await db.runAsync(
            'INSERT INTO registros (sessao, codigo, datahora) VALUES (?, ?, datetime("now", "localtime"));',
            [sessionName, data]
          );
          setIsCoolingDown(true);
          await loadCounts();
        }
      }
    } catch (err) {
      console.error('Erro ao salvar leitura ou verificar matrícula:', err);
      setFeedback({ message: '⚠️ Erro!', color: '#FF5555', textColor: '#fff' });
    }

    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
    }
    cooldownTimerRef.current = setTimeout(() => {
      setFeedback({ message: 'Pronto', color: '#2E7D32', textColor: '#fff' });
      setScanned(false);
      setIsCoolingDown(false);
    }, COOLDOWN_MS);
  };

  return (
    <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
      {/* Feedback textual visível */}
      <View style={[styles.feedbackTop, { backgroundColor: feedback.color }]}>
        <Text style={[styles.feedbackText, { color: feedback.textColor }]}>{feedback.message}</Text>
      </View>

      {/* Área da câmera */}
      <View style={styles.cameraBox}>
        <CameraView
          active={!isCoolingDown}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          style={styles.cameraView}
        />
        {isCoolingDown && (
          <View style={styles.cameraMask}>
            <Text style={styles.cameraMaskText}>Aguarde</Text>
          </View>
        )}
      </View>

      {/* Rodapé com sessão e contadores */}
      <View style={styles.overlay}>
        <Text style={styles.sessionTitle}>Sessão: {sessionName}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', width: '100%' }}>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.counterLabel}>Técnico</Text>
            <Text style={styles.counterValue}>{countTecnico}</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.counterLabel}>Superior</Text>
            <Text style={styles.counterValue}>{countSuperior}</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.counterLabel}>Total</Text>
            <Text style={styles.counterValue}>{count}</Text>
          </View>
        </View>
        <View style={{ marginTop: 10 }}>
          <Button title="Encerrar leitura" onPress={() => navigation.goBack()} />
        </View>
      </View>
    </View>
  );
}

// 📜 Tela de histórico
function HistoryScreen() {
  const [records, setRecords] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState('todas');
  const [stats, setStats] = useState({ tecnico: 0, superior: 0 });

  const loadSessions = async () => {
    const s = await db.getAllAsync('SELECT DISTINCT sessao FROM registros;');
    setSessions(s.map((item) => item.sessao));
  };

  const loadData = async (sessao = 'todas') => {
    let data;
    let counts;
    if (sessao === 'todas') {
      data = await db.getAllAsync(`
        SELECT r.*, a.curso 
        FROM registros r 
        LEFT JOIN alunos a ON r.codigo = a.matricula 
        ORDER BY r.sessao, r.id DESC;
      `);
      counts = await db.getAllAsync(`
        SELECT 
          SUM(CASE WHEN a.curso LIKE '0403%' THEN 1 ELSE 0 END) as tecnico,
          SUM(CASE WHEN a.curso NOT LIKE '0403%' THEN 1 ELSE 0 END) as superior
        FROM registros r
        JOIN alunos a ON r.codigo = a.matricula;
      `);
    } else {
      data = await db.getAllAsync(`
        SELECT r.*, a.curso 
        FROM registros r 
        LEFT JOIN alunos a ON r.codigo = a.matricula 
        WHERE r.sessao = ? 
        ORDER BY r.id DESC;
      `, [sessao]);
      counts = await db.getAllAsync(`
        SELECT 
          SUM(CASE WHEN a.curso LIKE '0403%' THEN 1 ELSE 0 END) as tecnico,
          SUM(CASE WHEN a.curso NOT LIKE '0403%' THEN 1 ELSE 0 END) as superior
        FROM registros r
        JOIN alunos a ON r.codigo = a.matricula
        WHERE r.sessao = ?;
      `, [sessao]);
    }
    setRecords(data);
    setStats({
      tecnico: counts[0]?.tecnico || 0,
      superior: counts[0]?.superior || 0
    });
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
      page.drawText('Relatório de Leituras', { x: 50, y, size: 20, font, color: rgb(0, 0, 0) });
      y -= 30;

      // Estatísticas
      page.drawText(`Técnico (0403): ${stats.tecnico}`, { x: 50, y, size: 12, font });
      page.drawText(`Superior / Outros: ${stats.superior}`, { x: 200, y, size: 12, font });
      page.drawText(`Total: ${records.length}`, { x: 350, y, size: 12, font });
      y -= 25;

      // Cabeçalho
      page.drawText('Sessão', { x: 50, y, size: 10, font, color: rgb(0, 0, 1) });
      page.drawText('Código', { x: 150, y, size: 10, font, color: rgb(0, 0, 1) });
      page.drawText('Curso', { x: 250, y, size: 10, font, color: rgb(0, 0, 1) });
      page.drawText('Data/Hora', { x: 450, y, size: 10, font, color: rgb(0, 0, 1) });
      y -= 15;

      records.forEach((item) => {
        if (y < 50) return; // Simples proteção de página única para este exemplo
        page.drawText(String(item.sessao).substring(0, 15), { x: 50, y, size: 9, font });
        page.drawText(String(item.codigo), { x: 150, y, size: 9, font });
        const cursoResumo = item.curso ? (item.curso.includes('0403') ? 'Técnico' : 'Superior') : 'N/A';
        page.drawText(cursoResumo, { x: 250, y, size: 9, font });
        page.drawText(item.datahora, { x: 450, y, size: 9, font });
        y -= 12;
      });

      const pdfBytes = await pdfDoc.save();
      const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));
      const fileUri = `${FileSystem.documentDirectory}historico_${selectedSession}.pdf`;

      await FileSystem.writeAsStringAsync(fileUri, pdfBase64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(fileUri);
    } catch (err) {
      console.error('Erro ao exportar PDF:', err);
      Alert.alert('Erro', 'Falha ao gerar PDF.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📜 Histórico de Leituras</Text>
      
      <View style={styles.statsContainer}>
        <Text style={styles.statsText}>Técnico: {stats.tecnico} | Superior: {stats.superior}</Text>
      </View>

      <Picker
        selectedValue={selectedSession}
        onValueChange={(itemValue) => setSelectedSession(itemValue)}
        style={styles.picker}
      >
        <Picker.Item label="Todas as sessões" value="todas" />
        {sessions.map((s) => (
          <Picker.Item key={s} label={s} value={s} />
        ))}
      </Picker>

      <View style={{ marginVertical: 10 }}>
        <Button title="Exportar PDF" onPress={exportPDF} />
      </View>

      <FlatList
        data={records}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.listItem}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listText}>{item.sessao}</Text>
              <Text style={styles.listCode}>Matrícula: {item.codigo}</Text>
              <Text style={styles.listDate}>{item.datahora}</Text>
              <Text style={styles.listDate}>Curso: {item.curso?.substring(0, 40)}...</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

// 📊 Gráfico de Barras Simples
const MiniBarChart = ({ title, data, color }) => {
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  return (
    <View style={styles.chartContainer}>
      <Text style={styles.chartTitle}>{title}</Text>
      {data.map((item, index) => (
        <View key={index} style={styles.chartRow}>
          <Text style={styles.chartLabel}>{item.label}</Text>
          <View style={styles.chartTrack}>
            <View
              style={[
                styles.chartBar,
                { width: `${(item.value / maxValue) * 100}%`, backgroundColor: color },
              ]}
            />
          </View>
          <Text style={styles.chartValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
};

// 📊 Tela Central de Leituras
function ReadingCenterScreen() {
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [summary, setSummary] = useState({ nome: '', total: 0, firstRead: '', lastRead: '' });
  const [hourData, setHourData] = useState([]);
  const [sessionData, setSessionData] = useState([]);
  const [recentReads, setRecentReads] = useState([]);

  const loadStudentsWithReads = useCallback(async () => {
    try {
      const data = await db.getAllAsync(`
        SELECT a.matricula, a.nome, COUNT(r.id) as total 
        FROM alunos a 
        JOIN registros r ON a.matricula = r.codigo 
        GROUP BY a.matricula 
        ORDER BY total DESC;
      `);
      setStudents(data);
      if (data.length > 0 && !selectedStudent) {
        setSelectedStudent(data[0].matricula);
      }
    } catch (err) {
      console.error('Erro ao carregar alunos:', err);
    }
  }, [selectedStudent]);

  const loadStudentAnalytics = useCallback(async (matricula) => {
    try {
      const info = await db.getFirstAsync(
        'SELECT nome FROM alunos WHERE matricula = ?;',
        [matricula]
      );
      const totalReads = await db.getFirstAsync(
        'SELECT COUNT(*) as total, MIN(datahora) as first, MAX(datahora) as last FROM registros WHERE codigo = ?;',
        [matricula]
      );
      const byHour = await db.getAllAsync(
        "SELECT strftime('%H', datahora) as hour, COUNT(*) as total FROM registros WHERE codigo = ? GROUP BY hour;",
        [matricula]
      );
      const bySession = await db.getAllAsync(
        'SELECT sessao, COUNT(*) as total FROM registros WHERE codigo = ? GROUP BY sessao;',
        [matricula]
      );
      const latestReads = await db.getAllAsync(
        'SELECT sessao, datahora FROM registros WHERE codigo = ? ORDER BY id DESC LIMIT 5;',
        [matricula]
      );

      setSummary({
        nome: info.nome,
        total: totalReads.total,
        firstRead: totalReads.first,
        lastRead: totalReads.last,
      });

      setHourData(
        byHour.map((item) => ({
          label: `${item.hour}h`,
          value: Number(item.total),
        }))
      );

      setSessionData(
        bySession.map((item) => ({
          label: item.sessao,
          value: Number(item.total),
        }))
      );

      setRecentReads(latestReads);
    } catch (err) {
      console.error('Erro ao carregar análises do aluno:', err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStudentsWithReads();
    }, [loadStudentsWithReads])
  );

  useEffect(() => {
    if (selectedStudent) {
      loadStudentAnalytics(selectedStudent);
    }
  }, [selectedStudent, loadStudentAnalytics]);

  return (
    <ScrollView contentContainerStyle={styles.readingCenterContainer}>
      <Text style={styles.title}>📊 Central de Leituras</Text>

      {students.length === 0 ? (
        <Text style={{ textAlign: 'center', marginTop: 20 }}>Nenhuma leitura encontrada para analisar.</Text>
      ) : (
        <>
          <View style={styles.filterContainer}>
            <Text style={styles.filterLabel}>Selecione o aluno:</Text>
            <Picker
              selectedValue={selectedStudent}
              style={styles.picker}
              onValueChange={(itemValue) => setSelectedStudent(itemValue)}
            >
              {students.map((s) => (
                <Picker.Item
                  key={s.matricula}
                  label={`${s.nome} (${s.matricula}) - ${s.total} leituras`}
                  value={s.matricula}
                />
              ))}
            </Picker>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>{summary.nome}</Text>
            <Text style={styles.summaryText}>Matrícula: {selectedStudent}</Text>
            <Text style={styles.summaryText}>Total de leituras: {summary.total}</Text>
            <Text style={styles.summaryText}>Primeira leitura: {summary.firstRead || '-'}</Text>
            <Text style={styles.summaryText}>Última leitura: {summary.lastRead || '-'}</Text>
          </View>

          <MiniBarChart title="Leituras por horário" data={hourData} color="#F9A825" />
          <MiniBarChart title="Leituras por sessão" data={sessionData} color="#2E7D32" />

          <View style={styles.chartContainer}>
            <Text style={styles.chartTitle}>Horários recentes</Text>
            {recentReads.length === 0 ? (
              <Text style={styles.emptyChartText}>Sem registros recentes.</Text>
            ) : (
              recentReads.map((item, index) => (
                <View key={`${item.datahora}-${index}`} style={styles.recentItem}>
                  <Text style={styles.recentSession}>{item.sessao}</Text>
                  <Text style={styles.recentTime}>{item.datahora}</Text>
                </View>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
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

      if (res.canceled) return;

      const fileUri = res.assets[0].uri;
      const fileContent = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });

      const workbook = XLSX.read(fileContent, { type: 'base64' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet);

      if (json.length === 0) {
        Alert.alert('Erro', 'A planilha está vazia.');
        return;
      }

      const insertPromises = json.map(async (row) => {
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
          await db.runAsync(
            'INSERT INTO alunos (matricula, nome, curso) VALUES (?, ?, ?) ON CONFLICT(matricula) DO UPDATE SET nome = excluded.nome, curso = excluded.curso;',
            [matricula, nome, curso]
          );
        }
      });

      await Promise.all(insertPromises);
      Alert.alert('Sucesso', `${json.length} alunos processados!`);
      loadAlunos();
    } catch (error) {
      console.error('Erro ao importar alunos:', error);
      Alert.alert('Erro', 'Falha ao importar planilha.');
    }
  };

  const clearStudents = async () => {
    Alert.alert(
      'Confirmar Limpeza',
      'Apagar todos os alunos?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar', onPress: async () => {
            await db.runAsync('DELETE FROM alunos;');
            loadAlunos();
          }
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🧑‍🎓 Gerenciar Alunos</Text>
      <View style={{ marginVertical: 10 }}>
        <Button title="Importar Alunos (Planilha)" onPress={importStudents} />
      </View>
      <View style={{ marginVertical: 10 }}>
        <Button title="Limpar Tabela" color="red" onPress={clearStudents} />
      </View>
      <Text style={styles.countText}>Total: {alunos.length}</Text>
      <FlatList
        data={alunos}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <View style={styles.listItem}>
            <View style={{ flex: 1 }}>
              <Text style={styles.listText}>{item.nome}</Text>
              <Text style={styles.listCode}>{item.matricula}</Text>
              <Text style={styles.listDate}>{item.curso}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

// ℹ️ Tela de Ajuda
function HelpScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>ℹ️ Ajuda</Text>
      <Text style={styles.helpText}>1. Importe os alunos via planilha.</Text>
      <Text style={styles.helpText}>2. Inicie uma sessão de leitura.</Text>
      <Text style={styles.helpText}>3. O app diferencia cursos Técnicos (0403) de Superiores.</Text>
      <Text style={styles.helpText}>4. "Pronto" (Verde) = Aguardando leitura.</Text>
      <Text style={styles.helpText}>5. "Aguarde" (Amarelo) = Processando/Intervalo.</Text>
    </View>
  );
}

// 🚀 App principal
export default function App() {
  const [dbReady, setDbReady] = useState(false);
  useEffect(() => { initDatabase(setDbReady); }, []);
  if (!dbReady) return <View style={styles.container}><Text>Carregando...</Text></View>;

  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'QR Lanche' }} />
        <Stack.Screen name="Scanner" component={ScannerScreen} options={{ title: 'Leitura' }} />
        <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Histórico' }} />
        <Stack.Screen name="ReadingCenter" component={ReadingCenterScreen} options={{ title: 'Central de Leituras' }} />
        <Stack.Screen name="ManageStudents" component={ManageStudentsScreen} options={{ title: 'Gerenciar Alunos' }} />
        <Stack.Screen name="Help" component={HelpScreen} options={{ title: 'Ajuda' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// 🎨 Estilos
const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f2f2f2' },
  label: { fontSize: 16, marginBottom: 5 },
  input: { borderWidth: 1, borderColor: '#999', borderRadius: 8, padding: 10, marginBottom: 10, backgroundColor: '#fff' },
  overlay: { position: 'absolute', bottom: 20, left: 20, right: 20, backgroundColor: '#000000CC', padding: 15, borderRadius: 10, alignItems: 'center' },
  sessionTitle: { color: '#fff', fontSize: 20, marginBottom: 10 },
  counterLabel: { color: '#AAA', fontSize: 12, fontWeight: 'bold' },
  counterValue: { color: '#FFF', fontSize: 22, fontWeight: 'bold' },
  title: { fontSize: 20, textAlign: 'center', marginBottom: 20, fontWeight: 'bold' },
  filterContainer: { marginBottom: 10 },
  filterLabel: { fontSize: 14, marginBottom: 5 },
  picker: { backgroundColor: '#fff', borderRadius: 8 },
  countText: { textAlign: 'center', marginBottom: 10, fontWeight: 'bold' },
  listItem: { flexDirection: 'row', backgroundColor: '#fff', padding: 10, marginBottom: 10, borderRadius: 8, borderLeftWidth: 5, borderLeftColor: '#4CAF50' },
  listText: { fontSize: 16, fontWeight: 'bold' },
  listCode: { fontSize: 14, color: '#333' },
  listDate: { fontSize: 12, color: '#555' },
  cameraBox: { width: 300, height: 300, borderWidth: 4, borderColor: '#000', borderRadius: 10, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  cameraView: { width: '100%', height: '100%' },
  feedbackTop: { position: 'absolute', top: 40, left: 20, right: 20, padding: 30, borderRadius: 10, alignItems: 'center', zIndex: 10, elevation: 10 },
  feedbackText: { fontSize: 45, fontWeight: 'bold', textAlign: 'center', transform: [{ rotate: '180deg' }] },
  cameraMask: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0, 0, 0, 0.65)', alignItems: 'center', justifyContent: 'center' },
  cameraMaskText: { fontSize: 32, fontWeight: 'bold', color: '#FFD400' },
  helpText: { fontSize: 16, marginBottom: 10, color: '#333', lineHeight: 22 },
  readingCenterContainer: { padding: 20, backgroundColor: '#f2f2f2', paddingBottom: 40 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, borderLeftWidth: 5, borderLeftColor: '#1E88E5' },
  summaryTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 8, color: '#222' },
  summaryText: { fontSize: 14, color: '#333', marginBottom: 4 },
  chartContainer: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 12 },
  chartTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10, color: '#222' },
  chartRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  chartLabel: { width: 72, fontSize: 12, color: '#444' },
  chartTrack: { flex: 1, height: 12, backgroundColor: '#E5E7EB', borderRadius: 999, overflow: 'hidden' },
  chartBar: { height: '100%', borderRadius: 999 },
  chartValue: { width: 35, textAlign: 'right', marginLeft: 8, fontSize: 12, color: '#222', fontWeight: 'bold' },
  emptyChartText: { color: '#666', fontStyle: 'italic' },
  recentItem: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#ECECEC' },
  recentSession: { fontSize: 13, color: '#333', fontWeight: 'bold' },
  recentTime: { fontSize: 12, color: '#555' },
  statsContainer: { backgroundColor: '#E8F5E9', padding: 10, borderRadius: 8, marginBottom: 10, alignItems: 'center' },
  statsText: { fontWeight: 'bold', color: '#2E7D32' },
});
