function doGet(e) {
  try {
    // Pobierz parametry z URL
    const question = e.parameter.question || "";
    const answer = e.parameter.answer || "";
    const assistantName = e.parameter.assistantName || "";
    const assistantId = e.parameter.assistantId || "";
    const sheetId = e.parameter.sheetId || "";
    const sheetName = e.parameter.sheetName || "";
    const callback = e.parameter.callback || "";
    const isRated = e.parameter.isRated || "false";
    const updateExisting = e.parameter.updateExisting || "false";
    
    // Loguj parametry dla debugowania
    Logger.log('Parametry otrzymane:');
    Logger.log('sheetId: ' + sheetId);
    Logger.log('sheetName: ' + sheetName);
    Logger.log('question: ' + question);
    Logger.log('assistantName: ' + assistantName);
    Logger.log('isRated: ' + isRated);
    Logger.log('updateExisting: ' + updateExisting);
    
    // Sprawdź czy mamy wymagane dane
    if (!question || !assistantName || !assistantId || !sheetId || !sheetName) {
      const errorResponse = {
        success: false,
        error: 'Brak wymaganych parametrów: question, assistantName, assistantId, sheetId, sheetName',
        receivedParams: { question, assistantName, assistantId, sheetId, sheetName }
      };
      
      if (callback) {
        return ContentService.createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      } else {
        return ContentService.createTextOutput(JSON.stringify(errorResponse))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // Pobierz arkusz po ID
    let spreadsheet;
    try {
      Logger.log('Próba otwarcia arkusza o ID: ' + sheetId);
      spreadsheet = SpreadsheetApp.openById(sheetId);
      Logger.log('Arkusz otwarty pomyślnie');
    } catch (error) {
      Logger.log('Błąd podczas otwierania arkusza: ' + error.toString());
      const errorResponse = {
        success: false,
        error: `Nie można otworzyć arkusza o ID: ${sheetId}. Błąd: ${error.toString()}`,
        sheetId: sheetId
      };
      
      if (callback) {
        return ContentService.createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      } else {
        return ContentService.createTextOutput(JSON.stringify(errorResponse))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    if (!spreadsheet) {
      const errorResponse = {
        success: false,
        error: 'Nie można otworzyć arkusza - spreadsheet jest null'
      };
      
      if (callback) {
        return ContentService.createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      } else {
        return ContentService.createTextOutput(JSON.stringify(errorResponse))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // Pobierz arkusz po nazwie
    let sheet;
    try {
      Logger.log('Próba pobrania arkusza o nazwie: ' + sheetName);
      sheet = spreadsheet.getSheetByName(sheetName);
      Logger.log('Arkusz pobrany pomyślnie');
    } catch (error) {
      Logger.log('Błąd podczas pobierania arkusza: ' + error.toString());
      const errorResponse = {
        success: false,
        error: `Nie można znaleźć arkusza o nazwie: ${sheetName}. Błąd: ${error.toString()}`,
        sheetName: sheetName,
        availableSheets: spreadsheet.getSheets().map(s => s.getName())
      };
      
      if (callback) {
        return ContentService.createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      } else {
        return ContentService.createTextOutput(JSON.stringify(errorResponse))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    if (!sheet) {
      const availableSheets = spreadsheet.getSheets().map(s => s.getName());
      const errorResponse = {
        success: false,
        error: `Nie można znaleźć arkusza o nazwie: ${sheetName}`,
        sheetName: sheetName,
        availableSheets: availableSheets
      };
      
      if (callback) {
        return ContentService.createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      } else {
        return ContentService.createTextOutput(JSON.stringify(errorResponse))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // Sprawdź czy aktualizujemy istniejący wiersz
    if (updateExisting === "true") {
      try {
        Logger.log('Próba aktualizacji istniejącego wiersza...');
        Logger.log('Szukam wiersza z pytaniem: ' + question);
        Logger.log('Szukam wiersza z odpowiedzią: ' + answer);
        Logger.log('Szukam wiersza z asystentem: ' + assistantName);
        
        // Znajdź wiersz z tym samym pytaniem, odpowiedzią i asystentem
        const data = sheet.getDataRange().getValues();
        let rowToUpdate = -1;
        
        Logger.log('Liczba wierszy w arkuszu: ' + data.length);
        
        // Funkcja do normalizacji tekstu dla porównania
        const normalizeText = (text) => {
          if (!text) return "";
          return text.toString()
            .replace(/<[^>]*>/g, '') // Usuń HTML tagi
            .replace(/\s+/g, ' ') // Zamień wielokrotne spacje na pojedyncze
            .replace(/ℹ️/g, '') // Usuń symbol ℹ️
            .trim()
            .toLowerCase(); // Porównuj bez rozróżniania wielkości liter
        };
        
        const normalizedQuestion = normalizeText(question);
        const normalizedAnswer = normalizeText(answer);
        
        for (let i = 1; i < data.length; i++) { // Pomijamy nagłówek
          const row = data[i];
          const rowQuestion = normalizeText(row[1]);
          const rowAnswer = normalizeText(row[2]);
          const rowAssistant = row[3];
          
          Logger.log(`Sprawdzam wiersz ${i}: pytanie="${row[1]}", odpowiedź="${row[2]}", asystent="${row[3]}"`);
          Logger.log(`Znormalizowane: pytanie="${rowQuestion}", odpowiedź="${rowAnswer}", asystent="${rowAssistant}"`);
          
          // Sprawdź czy wszystkie pola pasują (z normalizacją)
          const questionMatch = rowQuestion === normalizedQuestion;
          const answerMatch = rowAnswer === normalizedAnswer;
          const assistantMatch = rowAssistant === assistantName;
          
          Logger.log(`Wiersz ${i}: pytanie=${questionMatch}, odpowiedź=${answerMatch}, asystent=${assistantMatch}`);
          
          if (questionMatch && answerMatch && assistantMatch) {
            rowToUpdate = i + 1; // +1 bo getValues() zwraca indeksy od 0, ale wiersze od 1
            Logger.log(`Znaleziono pasujący wiersz: ${rowToUpdate}`);
            break;
          }
        }
        
        if (rowToUpdate > 0) {
          // Aktualizuj kolumnę F (indeks 5) - status oceny
          const ratingText = isRated === "positive" ? "Ocenione pozytywnie" : 
                            isRated === "negative" ? "Ocenione negatywnie" : 
                            "Nieocenione";
          sheet.getRange(rowToUpdate, 6).setValue(ratingText);
          Logger.log(`Zaktualizowano wiersz ${rowToUpdate} - status oceny`);
          
          const successResponse = {
            success: true,
            message: 'Status oceny został zaktualizowany',
            timestamp: new Date().toISOString(),
            sheetId: sheetId,
            sheetName: sheetName,
            updatedRow: rowToUpdate,
            isRated: isRated
          };
          
          if (callback) {
            return ContentService.createTextOutput(`${callback}(${JSON.stringify(successResponse)})`)
              .setMimeType(ContentService.MimeType.JAVASCRIPT);
          } else {
            return ContentService.createTextOutput(JSON.stringify(successResponse))
              .setMimeType(ContentService.MimeType.JSON);
          }
        } else {
          // Jeśli nie znaleziono wiersza, dodaj nowy
          Logger.log('Nie znaleziono wiersza do aktualizacji, dodaję nowy');
          Logger.log('Znormalizowane wartości szukane:');
          Logger.log('Pytanie: "' + normalizedQuestion + '"');
          Logger.log('Odpowiedź: "' + normalizedAnswer + '"');
          Logger.log('Asystent: "' + assistantName + '"');
        }
      } catch (error) {
        Logger.log('Błąd podczas aktualizacji wiersza: ' + error.toString());
        // Jeśli błąd, dodaj nowy wiersz
      }
    }
    
    // Zapisz dane do arkusza (nowy wiersz)
    const rowData = [
      new Date(),                    // Timestamp
      question,                      // Pytanie
      answer,                        // Odpowiedź
      assistantName,                 // Nazwa asystenta
      assistantId,                   // ID asystenta
      isRated === "positive" ? "Ocenione pozytywnie" : 
      isRated === "negative" ? "Ocenione negatywnie" : 
      "Nieocenione"  // Status oceny
    ];
    
    Logger.log('Próba zapisu danych: ' + JSON.stringify(rowData));
    sheet.appendRow(rowData);
    Logger.log('Dane zapisane pomyślnie');
    
    // Zwróć sukces
    const successResponse = {
      success: true,
      message: 'Dane zostały zapisane',
      timestamp: new Date().toISOString(),
      sheetId: sheetId,
      sheetName: sheetName,
      isRated: isRated
    };
    
    if (callback) {
      return ContentService.createTextOutput(`${callback}(${JSON.stringify(successResponse)})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    } else {
      return ContentService.createTextOutput(JSON.stringify(successResponse))
        .setMimeType(ContentService.MimeType.JSON);
    }
      
  } catch (error) {
    // Zwróć błąd
    Logger.log('Ogólny błąd: ' + error.toString());
    const errorResponse = {
      success: false,
      error: error.toString(),
      message: 'Błąd podczas zapisu danych'
    };
    
    const callback = e.parameter.callback || "";
    if (callback) {
      return ContentService.createTextOutput(`${callback}(${JSON.stringify(errorResponse)})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    } else {
      return ContentService.createTextOutput(JSON.stringify(errorResponse))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
}

function doPost(e) {
  // Zachowaj kompatybilność z POST requests
  return doGet(e);
}

// Funkcja testowa do sprawdzenia czy arkusz działa
function testSheet() {
  try {
    const sheetId = "1-u6x4QMr-aK9sIDPcSuyfviXEYawyYxVfEshXoTLyDg";
    const sheetName = "Sheet1";
    
    Logger.log('Test: Próba otwarcia arkusza o ID: ' + sheetId);
    const spreadsheet = SpreadsheetApp.openById(sheetId);
    Logger.log('Test: Arkusz otwarty pomyślnie');
    
    Logger.log('Test: Próba pobrania arkusza o nazwie: ' + sheetName);
    const sheet = spreadsheet.getSheetByName(sheetName);
    Logger.log('Test: Arkusz pobrany pomyślnie');
    
    sheet.appendRow(['TEST', 'Test data', 'Test answer', 'Test assistant', 'test-id', 'Nieocenione']);
    Logger.log('Test zapisu udany');
    return true;
  } catch (error) {
    Logger.log('Błąd testu: ' + error.toString());
    return false;
  }
}