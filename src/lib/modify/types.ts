export interface FileEdit {
  filePath: string
  edits: Array<{ start: number; end: number; original: string; replacement: string }>
}

export interface RenameConflict {
  kind: 'collision' | 'external' | 'reserved' | 'not-found'
  message: string
}

export interface RenamePlan {
  fileEdits: FileEdit[]
  conflicts: RenameConflict[]
  safetyChecks: {
    tsConfigFound: boolean
    allFilesInProject: boolean
  }
}
