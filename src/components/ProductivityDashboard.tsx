import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  TrendingUp, 
  Clock, 
  CheckCircle2, 
  AlertTriangle,
  Target,
  Calendar,
  BarChart3,
  Zap
} from 'lucide-react';
import { Task } from '@/types/task';
import { itineraryEngine } from '@/utils/ItineraryEngine';

interface ProductivityDashboardProps {
  tasks: Task[];
}

const ProductivityDashboard: React.FC<ProductivityDashboardProps> = ({ tasks }) => {
  const insights = useMemo(async () => {
    return await itineraryEngine.getProductivityInsights(tasks);
  }, [tasks]);

  const stats = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'DONE');
    const inProgressTasks = tasks.filter(t => t.status === 'DOING');
    const blockedTasks = tasks.filter(t => t.status === 'BLOCKED');
    
    const overdueTasks = tasks.filter(t => 
      t.due_date && 
      new Date(t.due_date) < now && 
      t.status !== 'DONE'
    );

    const completedThisWeek = completedTasks.filter(t =>
      t.completed_at && new Date(t.completed_at) >= weekAgo
    );

    const completedThisMonth = completedTasks.filter(t =>
      t.completed_at && new Date(t.completed_at) >= monthAgo
    );

    // Priority distribution
    const priorityStats = {
      URGENT: tasks.filter(t => t.priority === 'URGENT').length,
      HIGH: tasks.filter(t => t.priority === 'HIGH').length,
      MEDIUM: tasks.filter(t => t.priority === 'MEDIUM').length,
      LOW: tasks.filter(t => t.priority === 'LOW').length,
    };

    // Category distribution
    const categoryStats = {
      LIFE: tasks.filter(t => t.category === 'LIFE').length,
      CAREER: tasks.filter(t => t.category === 'CAREER').length,
      VENTURES: tasks.filter(t => t.category === 'VENTURES').length,
      EDUCATION: tasks.filter(t => t.category === 'EDUCATION').length,
    };

    // Average completion time
    const tasksWithEstimates = completedTasks.filter(t => t.estimate_minutes);
    const avgCompletionTime = tasksWithEstimates.length > 0
      ? tasksWithEstimates.reduce((sum, t) => sum + (t.estimate_minutes || 0), 0) / tasksWithEstimates.length
      : 0;

    // Completion rate
    const completionRate = totalTasks > 0 ? (completedTasks.length / totalTasks) * 100 : 0;

    return {
      totalTasks,
      completedTasks: completedTasks.length,
      inProgressTasks: inProgressTasks.length,
      blockedTasks: blockedTasks.length,
      overdueTasks: overdueTasks.length,
      completedThisWeek: completedThisWeek.length,
      completedThisMonth: completedThisMonth.length,
      completionRate,
      avgCompletionTime,
      priorityStats,
      categoryStats
    };
  }, [tasks]);

  const formatTime = (minutes: number): string => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5" />
        <h2 className="text-lg font-semibold">Productivity Dashboard</h2>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{stats.totalTasks}</p>
                <p className="text-xs text-muted-foreground">Total Tasks</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{stats.completedTasks}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-500" />
              <div>
                <p className="text-2xl font-bold">{stats.inProgressTasks}</p>
                <p className="text-xs text-muted-foreground">In Progress</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <div>
                <p className="text-2xl font-bold">{stats.overdueTasks}</p>
                <p className="text-xs text-muted-foreground">Overdue</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Completion Rate */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Completion Rate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Overall Progress</span>
              <span>{Math.round(stats.completionRate)}%</span>
            </div>
            <Progress value={stats.completionRate} className="h-2" />
            <div className="text-xs text-muted-foreground">
              {stats.completedTasks} of {stats.totalTasks} tasks completed
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">This Week</span>
              <Badge variant="outline">{stats.completedThisWeek} completed</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">This Month</span>
              <Badge variant="outline">{stats.completedThisMonth} completed</Badge>
            </div>
            {stats.avgCompletionTime > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Avg. Time</span>
                <Badge variant="outline">{formatTime(stats.avgCompletionTime)}</Badge>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Priority Distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(stats.priorityStats).map(([priority, count]) => (
              <div key={priority} className="flex justify-between items-center">
                <span className="text-sm capitalize text-muted-foreground">
                  {priority.toLowerCase()}
                </span>
                <Badge 
                  variant="outline"
                  className={
                    priority === 'URGENT' ? 'border-red-200 text-red-700' :
                    priority === 'HIGH' ? 'border-orange-200 text-orange-700' :
                    priority === 'MEDIUM' ? 'border-blue-200 text-blue-700' :
                    'border-gray-200 text-gray-700'
                  }
                >
                  {count}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Task Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(stats.categoryStats).map(([category, count]) => (
              <div key={category} className="text-center">
                <div className="text-lg font-bold">{count}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {category.toLowerCase()}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Insights */}
      {(stats.blockedTasks > 0 || stats.overdueTasks > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Insights & Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.blockedTasks > 0 && (
              <div className="flex items-start gap-2 p-2 bg-yellow-50 rounded-lg border border-yellow-200">
                <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-800">
                    {stats.blockedTasks} blocked task{stats.blockedTasks > 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-yellow-700">
                    Review task dependencies to unblock workflow
                  </p>
                </div>
              </div>
            )}
            
            {stats.overdueTasks > 0 && (
              <div className="flex items-start gap-2 p-2 bg-red-50 rounded-lg border border-red-200">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">
                    {stats.overdueTasks} overdue task{stats.overdueTasks > 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-red-700">
                    Consider rescheduling or updating due dates
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ProductivityDashboard;