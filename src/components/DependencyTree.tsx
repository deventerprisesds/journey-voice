import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Clock, ArrowDown } from 'lucide-react';
import { Task } from '@/types/task';

interface DependencyTreeProps {
  tasks: Task[];
  selectedTaskId?: string;
}

interface TaskNode {
  task: Task;
  dependencies: TaskNode[];
  dependents: TaskNode[];
  level: number;
}

const DependencyTree: React.FC<DependencyTreeProps> = ({ tasks, selectedTaskId }) => {
  const taskMap = useMemo(() => {
    return tasks.reduce((map, task) => {
      map[task.id] = task;
      return map;
    }, {} as Record<string, Task>);
  }, [tasks]);

  const buildTree = useMemo(() => {
    if (!selectedTaskId || !taskMap[selectedTaskId]) return null;

    const visited = new Set<string>();
    const building = new Set<string>();

    const buildNode = (taskId: string, level: number = 0): TaskNode | null => {
      if (building.has(taskId)) {
        // Circular dependency detected
        return null;
      }
      
      if (visited.has(taskId)) {
        return null;
      }

      const task = taskMap[taskId];
      if (!task) return null;

      building.add(taskId);
      visited.add(taskId);

      const dependencies: TaskNode[] = [];
      if (task.blocked_by) {
        for (const depId of task.blocked_by) {
          const depNode = buildNode(depId, level + 1);
          if (depNode) {
            dependencies.push(depNode);
          }
        }
      }

      // Find dependents (tasks that depend on this task)
      const dependents: TaskNode[] = [];
      const dependentTasks = tasks.filter(t => 
        t.blocked_by && t.blocked_by.includes(taskId) && t.id !== taskId
      );
      
      for (const dependent of dependentTasks) {
        if (!visited.has(dependent.id) && !building.has(dependent.id)) {
          const depNode = buildNode(dependent.id, level - 1);
          if (depNode) {
            dependents.push(depNode);
          }
        }
      }

      building.delete(taskId);

      return {
        task,
        dependencies,
        dependents,
        level
      };
    };

    return buildNode(selectedTaskId);
  }, [taskMap, selectedTaskId, tasks]);

  const getTaskStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'DONE':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'DOING':
        return <Clock className="h-4 w-4 text-blue-500" />;
      case 'BLOCKED':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getTaskStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'DONE':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'DOING':
        return 'bg-blue-50 border-blue-200 text-blue-800';
      case 'BLOCKED':
        return 'bg-red-50 border-red-200 text-red-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const renderTaskNode = (node: TaskNode, isSelected: boolean = false) => {
    const isBlocked = node.task.blocked_by && node.task.blocked_by.length > 0;
    const canStart = !isBlocked || node.task.blocked_by!.every(depId => 
      taskMap[depId]?.status === 'DONE'
    );

    return (
      <div
        key={node.task.id}
        className={`p-3 rounded-lg border transition-all ${
          isSelected 
            ? 'border-primary bg-primary/5 shadow-sm' 
            : getTaskStatusColor(node.task.status)
        }`}
      >
        <div className="flex items-start gap-2">
          {getTaskStatusIcon(node.task.status)}
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm truncate">{node.task.title}</h4>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-xs">
                {node.task.priority.toLowerCase()}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {node.task.category.toLowerCase()}
              </Badge>
              {isBlocked && !canStart && (
                <Badge variant="destructive" className="text-xs">
                  Blocked
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTree = (node: TaskNode, isSelected: boolean = false) => {
    return (
      <div key={node.task.id} className="space-y-3">
        {/* Dependencies (above) */}
        {node.dependencies.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Dependencies (must complete first):
            </div>
            <div className="space-y-2 ml-4 border-l-2 border-dashed border-gray-200 pl-4">
              {node.dependencies.map(dep => (
                <div key={dep.task.id}>
                  {renderTaskNode(dep)}
                  {dep.dependencies.length > 0 && (
                    <div className="ml-4 mt-2">
                      <ArrowDown className="h-4 w-4 text-gray-400 mb-2" />
                      {renderTree(dep)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Current task */}
        {renderTaskNode(node, isSelected)}

        {/* Dependents (below) */}
        {node.dependents.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Dependent tasks (waiting for this):
            </div>
            <div className="space-y-2 ml-4 border-l-2 border-dashed border-gray-200 pl-4">
              {node.dependents.map(dep => (
                <div key={dep.task.id}>
                  <ArrowDown className="h-4 w-4 text-gray-400 mb-2" />
                  {renderTaskNode(dep)}
                  {dep.dependents.length > 0 && (
                    <div className="ml-4 mt-2">
                      {renderTree(dep)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!buildTree) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Dependency Tree</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No task selected or task not found.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Dependency Tree</CardTitle>
        <p className="text-xs text-muted-foreground">
          Visual representation of task dependencies
        </p>
      </CardHeader>
      <CardContent>
        {renderTree(buildTree, true)}
      </CardContent>
    </Card>
  );
};

export default DependencyTree;