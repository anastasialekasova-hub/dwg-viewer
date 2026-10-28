// Every interface string. English everywhere; non-English locales carry only
// extName/extDescription until the listing translations land (ТЗ 8).
// extDescription stays the temporary pre-listing line until `--release`.
export const TEMP_EXT_DESCRIPTION = 'View DWG and DXF drawings in a Chrome tab.';

export const MESSAGES = {
  extName: 'DWG Viewer',
  extDescription: TEMP_EXT_DESCRIPTION,
  actionTitle: 'DWG Viewer',
  commandDesc: 'Open DWG Viewer',
  menuOpen: 'Open in DWG Viewer',

  startDrop: 'Drop a DWG or DXF file here',
  startOr: 'or',
  hintCtrl: 'Ctrl',
  hintO: 'O',
  hintMacCtrl: '⌘',
  openFile: 'Open file…',
  privacyLocal: 'Drawings are rendered on this computer.',
  privacyNoUpload: 'Nothing is uploaded.',
  rangeLine: 'Opens DWG files from AutoCAD $1 to $2, and DXF files.',

  loadingOpening: 'Opening $1',
  sizeMB: '$1 MB',
  sizeKB: '$1 KB',
  stageRead: 'Reading file',
  stageReadDwg: 'Reading DWG',
  stageReadDxf: 'Reading DXF',
  stageDraw: 'Drawing objects',
  progressObjects: '$1 of $2 objects',
  cancel: 'Cancel',

  statusFileTitle: '$1 · DWG Viewer',
  chipDwg: 'DWG · AutoCAD $1',
  chipDxf: 'DXF · AutoCAD $1',
  chipDxfPlain: 'DXF',
  statusDrawn: '$1 of $2 objects drawn',
  statusRendered: 'Rendered on this computer',

  errCantReadTitle: 'Can’t read this file',
  errCantReadBody: '$1 is not a DWG or DXF drawing, or the file is damaged.',
  errCantReadHint: 'If it opens in your CAD program, save it again and try here.',
  errOpenAnother: 'Open another file',
  errTryAgain: 'Try again',
  errVersionTitle: 'This DWG version isn’t supported',
  errVersionKnownBody:
    '$1 was saved in AutoCAD $2 ($3). DWG Viewer opens DWG files from AutoCAD $4 to $5.',
  errVersionUnknownBody:
    '$1 was saved in a DWG version DWG Viewer doesn’t know ($2). DWG Viewer opens DWG files from AutoCAD $3 to $4.',
  errVersionHint: 'Open it in a CAD program, save it as DWG 2018 or DXF, and drop it here again.',
  errTooLargeTitle: 'This drawing is too large to open here',
  errTooLargeBody: '$1 ($2) didn’t finish drawing in $3 seconds.',
  errTooLargeHint: 'Open it in a CAD program, or save only the part you need as a separate file.',

  partialSummary: 'Some objects were not drawn: $1.',
  partialItem: '$1 $2',
  partialRest: 'The rest of the drawing is shown.',
  partialDetails: 'Details',
  partialHideDetails: 'Hide details',
  partialDismiss: 'Dismiss',
  colType: 'Type',
  colCount: 'Count',
  colLayers: 'Layers',
  fontNote:
    'Text is drawn with a system font and may look different from your CAD program.',
};
