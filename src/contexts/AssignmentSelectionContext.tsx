import React, { createContext, useContext, useState, Dispatch, SetStateAction } from 'react';

interface AssignmentSelectionContextType {
  selectedAssignmentIds: Set<string>;
  setSelectedAssignmentIds: Dispatch<SetStateAction<Set<string>>>;
  toggleAssignment: (id: string) => void;
  clearSelection: () => void;
}

const AssignmentSelectionContext = createContext<AssignmentSelectionContextType | undefined>(undefined);

export const AssignmentSelectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<Set<string>>(new Set());

  const toggleAssignment = (id: string) => {
    setSelectedAssignmentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedAssignmentIds(new Set());
  };

  return (
    <AssignmentSelectionContext.Provider value={{
      selectedAssignmentIds,
      setSelectedAssignmentIds,
      toggleAssignment,
      clearSelection
    }}>
      {children}
    </AssignmentSelectionContext.Provider>
  );
};

export const useAssignmentSelection = () => {
  const context = useContext(AssignmentSelectionContext);
  if (!context) {
    throw new Error('useAssignmentSelection must be used within AssignmentSelectionProvider');
  }
  return context;
};
