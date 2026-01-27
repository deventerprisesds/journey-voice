import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { ArrowLeft, Menu } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface NavAction {
  label: string;
  icon?: React.ReactNode;
  to?: string;
  onClick?: () => void;
}

interface MobilePageHeaderProps {
  title: string;
  subtitle?: string;
  backTo?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  navActions?: NavAction[];
}

const MobilePageHeader: React.FC<MobilePageHeaderProps> = ({
  title,
  subtitle,
  backTo = '/',
  onBack,
  actions,
  navActions
}) => {
  const isMobile = useIsMobile();

  const BackButton = () => {
    if (onBack) {
      return (
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
      );
    }
    return (
      <Link to={backTo}>
        <Button variant="ghost" size="icon">
          <ArrowLeft className="h-5 w-5" />
        </Button>
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="container mx-auto px-4 py-3">
        {/* Mobile header */}
        {isMobile ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BackButton />
              <div>
                <h1 className="text-lg font-bold">{title}</h1>
                {subtitle && (
                  <p className="text-xs text-muted-foreground line-clamp-1">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {actions}
              {navActions && navActions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Menu className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 bg-popover">
                    {navActions.map((action, index) => (
                      <DropdownMenuItem 
                        key={index}
                        asChild={!!action.to}
                        onClick={action.onClick}
                      >
                        {action.to ? (
                          <Link to={action.to} className="flex items-center gap-2">
                            {action.icon}
                            {action.label}
                          </Link>
                        ) : (
                          <div className="flex items-center gap-2">
                            {action.icon}
                            {action.label}
                          </div>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        ) : (
          /* Desktop header */
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <BackButton />
              <div>
                <h1 className="text-2xl font-bold">{title}</h1>
                {subtitle && (
                  <p className="text-sm text-muted-foreground">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {navActions?.map((action, index) => (
                action.to ? (
                  <Link key={index} to={action.to}>
                    <Button variant="outline" size="sm" className="flex items-center gap-2">
                      {action.icon}
                      {action.label}
                    </Button>
                  </Link>
                ) : (
                  <Button 
                    key={index} 
                    variant="outline" 
                    size="sm" 
                    onClick={action.onClick}
                    className="flex items-center gap-2"
                  >
                    {action.icon}
                    {action.label}
                  </Button>
                )
              ))}
              {actions}
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default MobilePageHeader;
