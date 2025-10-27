import { Logger } from '../logger';

export const NotFound = () => {
    Logger.error('404 Not Found');
    return <div>Faktions Error: 404 Not Found</div>;
};
