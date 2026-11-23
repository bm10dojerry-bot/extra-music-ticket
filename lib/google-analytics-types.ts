/** Safe, aggregate-only contract shared by the Admin UI and server routes. */
export type GoogleAnalyticsPropertyOption={id:string;name:string;accountName:string};
export type GoogleAnalyticsStreamOption={id:string;name:string;siteUrl:string;measurementId:string;compatible:boolean};
export type GoogleAnalyticsSelectedProperty={id:string;name:string;streamId:string;streamName:string;siteUrl:string;measurementId:string};
export type GoogleAnalyticsReport={
 updatedAt:string;windowMinutes:30;totalActiveUsers:number;
 countries:Array<{countryId:string;country:string;activeUsers:number}>;
 cities:Array<{countryId:string;country:string;city:string;activeUsers:number}>;
 limited:boolean;
};
export type GoogleAnalyticsResponse={
 status:"not_connected"|"select_property"|"ready"|"error";
 canManage:boolean;connectAvailable:boolean;property:GoogleAnalyticsSelectedProperty|null;
 report?:GoogleAnalyticsReport;error?:string;
};
export const GOOGLE_ANALYTICS_CALLBACK_MESSAGES:Record<string,string>={
 denied:"Bạn chưa cấp quyền đọc Google Analytics. Có thể kết nối lại khi sẵn sàng.",
 invalid_state:"Phiên kết nối không hợp lệ, đã hết hạn hoặc đã được sử dụng. Vui lòng bắt đầu kết nối lại từ Admin.",
 expired_state:"Phiên kết nối đã hết hạn. Vui lòng bắt đầu kết nối lại từ Admin.",
 not_configured:"Máy chủ chưa sẵn sàng kết nối Google Analytics. Vui lòng kiểm tra cấu hình Google OAuth.",
 oauth_failed:"Google chưa hoàn tất cấp quyền đọc Analytics. Vui lòng thử kết nối lại.",
 scope_missing:"Google chưa cấp quyền đọc Analytics cho kết nối này. Vui lòng kết nối lại và cho phép quyền đọc Analytics.",
 refresh_token_missing:"Google chưa cấp quyền duy trì kết nối. Vui lòng kết nối lại và xác nhận quyền truy cập.",
 connection_changed:"Kết nối đã thay đổi trong khi xác thực. Vui lòng tải lại trang trước khi kết nối lại.",
 unavailable:"Chưa lưu được kết nối Google Analytics. Vui lòng thử lại.",
};
