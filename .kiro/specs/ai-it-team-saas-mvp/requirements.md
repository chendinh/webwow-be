# Requirements Document

## Introduction

Nền tảng **AI IT Team SaaS** là một dịch vụ phần mềm dạng SaaS dành cho các doanh nghiệp đã có website hoặc ứng dụng nhưng chưa có đội ngũ kỹ thuật nội bộ. Nền tảng đóng vai trò như một **đội IT AI toàn diện**, cho phép khách hàng kết nối kho lưu trữ GitHub hiện có, gửi yêu cầu sửa lỗi hoặc tính năng mới bằng ngôn ngữ tự nhiên, nhận phân tích chi phí và kế hoạch triển khai từ AI, phê duyệt kế hoạch, và để AI tự động thực thi thay đổi code — bao gồm chạy test, tạo nhánh Git và Pull Request.

Khách hàng mục tiêu **không cần hiểu lập trình**. Mọi khái niệm kỹ thuật phải được trình bày bằng ngôn ngữ thân thiện, dễ hiểu.

---

## Glossary

- **Platform**: Nền tảng AI IT Team SaaS — hệ thống tổng thể được mô tả trong tài liệu này.
- **AuthService**: Dịch vụ xử lý đăng ký, đăng nhập, xác thực và phân quyền người dùng.
- **OrgService**: Dịch vụ quản lý tổ chức (Organizations) và thành viên.
- **ProjectService**: Dịch vụ quản lý dự án (Projects) và thông tin kỹ thuật liên quan.
- **GitHubIntegration**: Mô-đun tích hợp với GitHub App để kết nối, đọc và ghi kho lưu trữ.
- **ProjectAnalyzer**: Tác nhân phân tích cấu trúc, kiến trúc và công nghệ của kho lưu trữ.
- **CompatibilityScorer**: Thành phần tính điểm tương thích của dự án với nền tảng AI.
- **ProjectContextProvider**: Lớp trừu tượng duy trì mô hình kiến thức persistent về dự án.
- **IssueService**: Dịch vụ quản lý yêu cầu (Issues) từ khách hàng.
- **AIAnalysisAgent**: Tác nhân AI phân tích yêu cầu, xác định file liên quan, rủi ro và tính khả thi.
- **PlanningAgent**: Tác nhân AI tạo kế hoạch triển khai chi tiết.
- **PricingService**: Dịch vụ tính toán chi phí từ phân tích AI và chuyển đổi thành giá khách hàng.
- **ApprovalService**: Dịch vụ quản lý luồng phê duyệt của khách hàng trước khi thực thi.
- **CodingAgent**: Tác nhân AI thực thi thay đổi code trong môi trường sandbox cô lập.
- **SandboxExecutor**: Môi trường cô lập để clone, chỉnh sửa, test và build code an toàn.
- **QueueService**: Dịch vụ hàng đợi (BullMQ/Redis) để xử lý các tác vụ chạy lâu.
- **ActivityLogger**: Thành phần ghi lại nhật ký hoạt động của mọi tác nhân AI và thay đổi trạng thái.
- **NotificationService**: Dịch vụ gửi thông báo tới khách hàng khi trạng thái thay đổi.
- **AIProvider**: Lớp trừu tượng cho các nhà cung cấp AI (OpenAI, Anthropic, v.v.).
- **Organization**: Tổ chức/công ty của khách hàng — đơn vị phân quyền đa thuê bao.
- **Project**: Dự án phần mềm của khách hàng, liên kết với một GitHub repository.
- **Issue**: Yêu cầu sửa lỗi hoặc tính năng mới được gửi bởi khách hàng.
- **AITask**: Tác vụ AI đại diện cho toàn bộ chu trình thực thi một Issue đã được phê duyệt.
- **AITaskStep**: Một bước con trong AITask (ví dụ: phân tích, viết code, chạy test).
- **ImplementationPlan**: Kế hoạch triển khai chi tiết do AI tạo ra, chờ khách hàng phê duyệt.
- **CostEstimate**: Ước tính chi phí AI và giá khách hàng cho một Issue.
- **PullRequest**: Pull Request được tạo trên GitHub sau khi AI hoàn thành thay đổi code.
- **User**: Người dùng đã xác thực, thuộc một hoặc nhiều Organization.
- **OrganizationMember**: Liên kết giữa User và Organization, kèm vai trò (OWNER, ADMIN, MEMBER).
- **ProjectAnalysis**: Kết quả phân tích kỹ thuật của một Project.
- **Usage**: Bản ghi sử dụng tài nguyên AI (token, thời gian, chi phí) theo tổ chức.

---

## Requirements

### Requirement 1: Xác Thực Người Dùng

**User Story:** Với tư cách là khách hàng, tôi muốn đăng ký và đăng nhập vào nền tảng, để có thể quản lý dự án của mình một cách an toàn.

#### Acceptance Criteria

1. THE **AuthService** SHALL cung cấp chức năng đăng ký tài khoản bằng email và mật khẩu với xác thực đầu vào theo định dạng chuẩn RFC 5321 cho email và tối thiểu 8 ký tự cho mật khẩu.
2. WHEN một người dùng đăng ký thành công, THE **AuthService** SHALL gửi email xác thực địa chỉ email trước khi kích hoạt tài khoản.
3. WHEN một người dùng đăng nhập với thông tin hợp lệ, THE **AuthService** SHALL phát hành JWT access token (thời hạn 15 phút) và refresh token (thời hạn 7 ngày).
4. WHEN một access token hết hạn, THE **AuthService** SHALL cho phép làm mới token bằng refresh token hợp lệ mà không yêu cầu đăng nhập lại.
5. IF một người dùng gửi thông tin đăng nhập không hợp lệ từ 5 lần liên tiếp, THEN THE **AuthService** SHALL khóa tài khoản tạm thời trong 15 phút và ghi nhật ký sự kiện bảo mật.
6. WHEN một người dùng yêu cầu đặt lại mật khẩu, THE **AuthService** SHALL gửi liên kết đặt lại có thời hạn 1 giờ đến email đã đăng ký.
7. THE **AuthService** SHALL hỗ trợ đăng nhập qua OAuth 2.0 với GitHub làm nhà cung cấp danh tính.
8. WHEN một người dùng đăng xuất, THE **AuthService** SHALL vô hiệu hóa refresh token hiện tại và xóa phiên làm việc.
9. THE **AuthService** SHALL lưu trữ mật khẩu bằng thuật toán bcrypt với cost factor tối thiểu là 12.

---

### Requirement 2: Quản Lý Tổ Chức Đa Thuê Bao

**User Story:** Với tư cách là chủ doanh nghiệp, tôi muốn tạo tổ chức cho công ty mình và mời thành viên, để cả nhóm có thể cùng quản lý dự án.

#### Acceptance Criteria

1. WHEN một người dùng tạo tổ chức mới, THE **OrgService** SHALL gán người tạo vai trò OWNER và tạo Organization với định danh UUID duy nhất.
2. THE **OrgService** SHALL hỗ trợ ba vai trò thành viên: OWNER (toàn quyền), ADMIN (quản lý dự án và thành viên), MEMBER (xem và tạo Issue).
3. WHEN một OWNER hoặc ADMIN gửi lời mời email, THE **OrgService** SHALL tạo invitation token có thời hạn 48 giờ và gửi email mời tới địa chỉ đích.
4. WHEN một người dùng chấp nhận lời mời hợp lệ, THE **OrgService** SHALL thêm người dùng vào tổ chức với vai trò đã chỉ định.
5. IF một người dùng cố gắng truy cập tài nguyên thuộc tổ chức mà họ không là thành viên, THEN THE **OrgService** SHALL trả về mã lỗi 403 Forbidden và không tiết lộ thông tin tổ chức đó.
6. THE **Platform** SHALL đảm bảo mọi tài nguyên thuộc sở hữu khách hàng (Project, Issue, AITask, PullRequest) đều liên kết với đúng một Organization và không bao giờ cho phép truy cập chéo giữa các tổ chức.
7. WHEN một OWNER xóa tổ chức, THE **OrgService** SHALL thực hiện soft delete, đánh dấu deletedAt và giữ toàn bộ dữ liệu trong 30 ngày trước khi xóa vĩnh viễn.
8. THE **OrgService** SHALL ghi nhật ký mọi thay đổi thành viên (thêm, xóa, thay đổi vai trò) vào ActivityLog kèm thông tin người thực hiện và thời điểm.

---

### Requirement 3: Kết Nối Kho Lưu Trữ GitHub

**User Story:** Với tư cách là khách hàng, tôi muốn kết nối kho lưu trữ GitHub hiện có của mình, để nền tảng có thể đọc và chỉnh sửa code của tôi theo yêu cầu.

#### Acceptance Criteria

1. THE **GitHubIntegration** SHALL sử dụng GitHub App (không phải Personal Access Token) làm cơ chế tích hợp chính thức để đọc và ghi kho lưu trữ.
2. WHEN một khách hàng cài đặt GitHub App trên tài khoản hoặc tổ chức GitHub của họ, THE **GitHubIntegration** SHALL lưu installation token được mã hóa và liên kết với Organization trong nền tảng.
3. THE **GitHubIntegration** SHALL không bao giờ lưu trữ GitHub Personal Access Token hoặc thông tin xác thực người dùng GitHub dạng plaintext.
4. WHEN một khách hàng chọn kết nối repository, THE **GitHubIntegration** SHALL liệt kê các repository mà GitHub App đã được cấp quyền truy cập trong vòng 5 giây.
5. WHEN một kho lưu trữ được kết nối thành công, THE **ProjectService** SHALL tạo bản ghi Project với trạng thái PENDING_ANALYSIS và enqueue tác vụ PROJECT_ANALYSIS vào QueueService.
6. IF quyền truy cập GitHub App bị thu hồi sau khi kết nối, THEN THE **GitHubIntegration** SHALL phát hiện lỗi xác thực trong vòng 24 giờ và thông báo cho OWNER của Organization qua NotificationService.
7. WHERE một khách hàng muốn chỉ định nhánh mặc định, THE **ProjectService** SHALL cho phép chọn nhánh phân tích và thực thi từ danh sách nhánh hiện có của repository.

---

### Requirement 4: Phân Tích Dự Án Tự Động

**User Story:** Với tư cách là khách hàng, tôi muốn nền tảng tự động hiểu cấu trúc kỹ thuật của dự án tôi, để AI có thể làm việc với code của tôi một cách chính xác.

#### Acceptance Criteria

1. WHEN tác vụ PROJECT_ANALYSIS được khởi động, THE **ProjectAnalyzer** SHALL kiểm tra và trích xuất thông tin từ các file: `package.json`, lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), `tsconfig.json`, cấu trúc thư mục nguồn, `Dockerfile`, `.github/workflows`, `README.md`, và file cấu hình môi trường (không đọc giá trị secrets).
2. THE **ProjectAnalyzer** SHALL phát hiện framework (React, Next.js, NestJS, Express, v.v.), ngôn ngữ lập trình chính, hệ quản trị cơ sở dữ liệu, và công cụ build dựa trên nội dung các file cấu hình.
3. THE **ProjectAnalyzer** SHALL phát hiện và che giấu (mask) các giá trị secrets tiềm ẩn (API keys, tokens, connection strings) trong mọi output phân tích trước khi lưu trữ.
4. WHEN phân tích hoàn tất, THE **ProjectAnalyzer** SHALL tạo bản ghi ProjectAnalysis bao gồm: kiến trúc tổng quan, danh sách dependencies chính, modules, routes/endpoints được phát hiện, test coverage đã biết, build scripts, và danh sách vấn đề đã biết.
5. THE **ProjectContextProvider** SHALL duy trì mô hình kiến thức persistent của dự án để tránh phải gửi toàn bộ repository cho mỗi yêu cầu AI, thay vào đó cung cấp context có cấu trúc cho các tác nhân AI.
6. IF tác vụ PROJECT_ANALYSIS thất bại, THEN THE **ProjectAnalyzer** SHALL ghi nhật ký lỗi đầy đủ, cập nhật trạng thái Project thành ANALYSIS_FAILED, và gửi thông báo tới OWNER qua NotificationService kèm hướng dẫn khắc phục.
7. THE **ProjectAnalyzer** SHALL hoàn thành phân tích trong vòng 10 phút cho repository dưới 500MB.

---

### Requirement 5: Điểm Tương Thích Dự Án

**User Story:** Với tư cách là khách hàng, tôi muốn biết dự án của mình tương thích với nền tảng AI đến mức nào, để tôi hiểu những gì AI có thể và không thể làm với code của tôi.

#### Acceptance Criteria

1. WHEN ProjectAnalysis hoàn tất, THE **CompatibilityScorer** SHALL tính điểm tương thích từ 0 đến 100 dựa trên các tiêu chí: ngôn ngữ/framework được hỗ trợ, sự hiện diện của tests, chất lượng cấu hình, và độ phức tạp của codebase.
2. THE **CompatibilityScorer** SHALL phân loại điểm thành bốn mức: FULL_AI_SUPPORT (90–100), AI_ASSISTED (70–89), LIMITED_SUPPORT (40–69), UNSUPPORTED (0–39).
3. THE **ProjectService** SHALL áp dụng giới hạn tự động hóa dựa trên mức phân loại: FULL_AI_SUPPORT cho phép tự động hóa hoàn toàn; AI_ASSISTED yêu cầu thêm bước xem xét thủ công; LIMITED_SUPPORT chỉ cho phép các thay đổi nhỏ; UNSUPPORTED không cho phép thực thi AI.
4. THE **CompatibilityScorer** SHALL tạo danh sách giải thích bằng ngôn ngữ thân thiện với khách hàng về các yếu tố ảnh hưởng đến điểm số và gợi ý cải thiện.
5. WHEN điểm tương thích dưới 40, THE **ProjectService** SHALL hiển thị cảnh báo rõ ràng cho khách hàng giải thích những hạn chế và các bước cần thực hiện để nâng cao điểm số.

---

### Requirement 6: Tạo Yêu Cầu (Issue) Bằng Ngôn Ngữ Tự Nhiên

**User Story:** Với tư cách là khách hàng không có kiến thức kỹ thuật, tôi muốn mô tả vấn đề hoặc tính năng mong muốn bằng lời thường ngày, để nền tảng hiểu và xử lý yêu cầu của tôi.

#### Acceptance Criteria

1. WHEN một khách hàng tạo Issue mới, THE **IssueService** SHALL nhận tiêu đề và mô tả bằng ngôn ngữ tự nhiên (tối thiểu 10 ký tự, tối đa 5000 ký tự cho mô tả) và lưu với các trường: title, description, type, priority, status, projectId, organizationId, createdBy.
2. THE **IssueService** SHALL hỗ trợ các loại Issue: BUG, FEATURE, REFACTOR, PERFORMANCE, SECURITY, DEPENDENCY, OTHER.
3. THE **IssueService** SHALL hỗ trợ các mức ưu tiên: CRITICAL, HIGH, MEDIUM, LOW.
4. WHEN một Issue được tạo thành công, THE **IssueService** SHALL đặt trạng thái ban đầu là ANALYZING và enqueue tác vụ phân tích AI vào QueueService.
5. IF một khách hàng cố gắng tạo Issue cho Project có trạng thái UNSUPPORTED, THEN THE **IssueService** SHALL từ chối tạo Issue và trả về thông báo giải thích lý do và các bước khắc phục.
6. THE **IssueService** SHALL áp dụng giới hạn tốc độ: mỗi Organization không được tạo quá 20 Issue mỗi ngày trong gói cơ bản.

---

### Requirement 7: Phân Tích AI và Lập Kế Hoạch Triển Khai

**User Story:** Với tư cách là khách hàng, tôi muốn nhận phân tích chi tiết từ AI về yêu cầu của mình kèm kế hoạch thực hiện, để tôi biết AI sẽ làm gì với code trước khi phê duyệt.

#### Acceptance Criteria

1. WHEN tác vụ phân tích AI được khởi động, THE **AIAnalysisAgent** SHALL sử dụng ProjectContextProvider để lấy context dự án thay vì clone toàn bộ repository.
2. THE **AIAnalysisAgent** SHALL xác định các file bị ảnh hưởng, modules liên quan, rủi ro tiềm ẩn, và dependencies chịu tác động — và SHALL chỉ báo cáo các file thực sự tồn tại trong repository đã được xác minh.
3. THE **AIAnalysisAgent** SHALL đánh giá tính khả thi của yêu cầu và ước tính mức độ phức tạp theo thang: LOW, MEDIUM, HIGH, CRITICAL.
4. WHEN phân tích AI hoàn tất, THE **PlanningAgent** SHALL tạo ImplementationPlan có cấu trúc JSON bao gồm: danh sách bước thực hiện có thứ tự, file cần thay đổi, loại thay đổi (CREATE/MODIFY/DELETE), test cần viết, và điều kiện rollback.
5. THE **AIAnalysisAgent** SHALL không suy đoán hoặc bịa đặt tên file, module, hoặc hàm không tồn tại trong codebase.
6. WHEN phân tích hoàn tất, THE **IssueService** SHALL cập nhật trạng thái Issue thành PLAN_READY và gửi thông báo tới khách hàng qua NotificationService.
7. IF phân tích AI thất bại sau 3 lần thử lại, THEN THE **AIAnalysisAgent** SHALL cập nhật trạng thái Issue thành ANALYSIS_FAILED và ghi lại lý do thất bại trong ActivityLog.
8. THE **AIAnalysisAgent** SHALL hoàn thành phân tích trong vòng 120 giây cho các Issue có độ phức tạp LOW và MEDIUM.
9. THE **AIAnalysisAgent** SHALL sử dụng IssueAnalysisPrompt và PlanningPrompt làm các prompt riêng biệt, xác thực mọi response AI theo JSON schema đã định nghĩa trước khi lưu trữ.

---

### Requirement 8: Ước Tính Chi Phí Minh Bạch

**User Story:** Với tư cách là khách hàng, tôi muốn biết chính xác chi phí thực thi một yêu cầu trước khi phê duyệt, để tôi có thể đưa ra quyết định kinh doanh có cơ sở.

#### Acceptance Criteria

1. WHEN ImplementationPlan được tạo, THE **PricingService** SHALL tính toán CostEstimate dựa trên: mức độ phức tạp, ước tính số token AI, số bước thực thi, mức rủi ro, và kích thước project.
2. THE **PricingService** SHALL phân tách rõ ràng: chi phí AI nội bộ (giá thành) và giá khách hàng (price) trong mọi CostEstimate, không bao giờ hiển thị chi phí AI nội bộ cho khách hàng.
3. THE **PricingService** SHALL hiển thị cho khách hàng: giá thực hiện ước tính, khoảng biến động (±20%), và thông tin so sánh với chi phí thuê developer thủ công.
4. THE **CostEstimate** SHALL bao gồm ngày hết hạn ước tính (24 giờ kể từ khi tạo) và hiển thị cảnh báo khi ước tính sắp hết hạn.
5. IF chi phí thực tế vượt quá ước tính ban đầu hơn 30%, THEN THE **PricingService** SHALL tạm dừng tác vụ và yêu cầu phê duyệt bổ sung từ khách hàng trước khi tiếp tục.

---

### Requirement 9: Luồng Phê Duyệt Khách Hàng

**User Story:** Với tư cách là khách hàng, tôi muốn xem xét và phê duyệt kế hoạch AI trước khi bất kỳ thay đổi nào được thực hiện trên code của tôi, để tôi luôn kiểm soát được dự án của mình.

#### Acceptance Criteria

1. THE **ApprovalService** SHALL đảm bảo AI không bao giờ thực hiện thay đổi code trước khi khách hàng phê duyệt rõ ràng — đây là quy tắc bắt buộc không có ngoại lệ.
2. WHEN Issue ở trạng thái PLAN_READY, THE **ApprovalService** SHALL hiển thị cho khách hàng: mô tả kế hoạch bằng ngôn ngữ thân thiện, danh sách file bị ảnh hưởng, mức rủi ro, ước tính chi phí, và thời gian thực thi dự kiến.
3. WHEN khách hàng phê duyệt kế hoạch, THE **ApprovalService** SHALL cập nhật trạng thái Issue thành APPROVED, ghi nhật ký quyết định phê duyệt vào ActivityLog (bao gồm userId, timestamp, ipAddress), và enqueue AITask vào QueueService.
4. WHEN khách hàng từ chối kế hoạch, THE **ApprovalService** SHALL cho phép nhập lý do từ chối, cập nhật trạng thái Issue thành REJECTED, và gửi feedback tới AIAnalysisAgent để tạo kế hoạch điều chỉnh nếu được yêu cầu.
5. THE **ApprovalService** SHALL gửi email nhắc nhở sau 24 giờ và 48 giờ nếu Issue ở trạng thái PLAN_READY chưa được xử lý.
6. IF ước tính chi phí hết hạn trong khi Issue đang chờ phê duyệt, THEN THE **ApprovalService** SHALL tự động tạo ước tính mới và thông báo cho khách hàng trước khi cho phép phê duyệt.

---

### Requirement 10: Trạng Thái AITask và Máy Trạng Thái

**User Story:** Với tư cách là khách hàng, tôi muốn theo dõi tiến độ thực thi của AI theo thời gian thực, để tôi biết chính xác AI đang làm gì với code của tôi.

#### Acceptance Criteria

1. THE **Platform** SHALL triển khai máy trạng thái AITask với các trạng thái hợp lệ: QUEUED → ANALYZING → PLANNING → WAITING_APPROVAL → APPROVED → PREPARING → CODING → TESTING → FIXING → REVIEWING → CREATING_PR → COMPLETED; và các trạng thái kết thúc ngoại lệ: FAILED, CANCELLED.
2. WHEN AITask chuyển sang bất kỳ trạng thái nào, THE **ActivityLogger** SHALL tạo bản ghi ActivityLog bao gồm: taskId, trạng thái cũ, trạng thái mới, timestamp, tác nhân khởi tạo chuyển tiếp, và thông điệp mô tả thân thiện với người dùng.
3. THE **Platform** SHALL không cho phép chuyển trạng thái AITask bỏ qua trạng thái trung gian — mọi chuyển tiếp phải tuân theo đồ thị trạng thái đã định nghĩa.
4. WHEN AITask ở trạng thái FAILED, THE **Platform** SHALL hiển thị thông báo lỗi thân thiện với khách hàng không chứa stack trace kỹ thuật nội bộ, cùng với các hành động tiếp theo có thể thực hiện (thử lại, liên hệ hỗ trợ, v.v.).
5. THE **QueueService** SHALL hỗ trợ retry tự động với exponential backoff cho các AITaskStep thất bại, tối đa 3 lần thử lại trước khi chuyển AITask sang FAILED.

---

### Requirement 11: Tác Nhân AI Viết Code (CodingAgent)

**User Story:** Với tư cách là khách hàng, tôi muốn AI tự động thực hiện các thay đổi code theo kế hoạch đã phê duyệt, để tôi không cần phải tự viết code hay thuê developer cho các thay đổi thông thường.

#### Acceptance Criteria

1. WHEN AITask chuyển sang trạng thái PREPARING, THE **CodingAgent** SHALL tạo workspace cô lập trong SandboxExecutor, clone repository về nhánh đã chỉ định, và tạo nhánh AI mới theo định dạng `ai/{issueId}-{slug}`.
2. THE **CodingAgent** SHALL thực thi các thay đổi file theo đúng danh sách đã được phê duyệt trong ImplementationPlan — không tạo, sửa, hoặc xóa file nào nằm ngoài danh sách đã phê duyệt.
3. WHEN thay đổi code hoàn tất, THE **CodingAgent** SHALL chạy tuần tự: formatter, linter, test suite, và build command — tất cả trong SandboxExecutor.
4. IF một bước kiểm tra (lint/test/build) thất bại, THEN THE **CodingAgent** SHALL chuyển AITask sang trạng thái FIXING và cố gắng tự sửa lỗi tối đa 3 lần trước khi chuyển sang FAILED với báo cáo lỗi đầy đủ.
5. WHEN tất cả kiểm tra vượt qua, THE **CodingAgent** SHALL commit thay đổi với commit message theo Conventional Commits, push lên nhánh AI, và tạo Pull Request trên GitHub với mô tả chi tiết bằng ngôn ngữ thân thiện.
6. THE **CodingAgent** SHALL không bao giờ merge Pull Request trực tiếp — đây là quyết định dành riêng cho khách hàng.
7. THE **CodingAgent** SHALL ghi nhật ký ActivityLog cho mọi lệnh thực thi (command, output, duration, exit code) trong SandboxExecutor.

---

### Requirement 12: An Toàn Sandbox và Quy Tắc Bảo Mật CodingAgent

**User Story:** Với tư cách là khách hàng, tôi muốn đảm bảo rằng AI chỉ làm việc trong môi trường an toàn cô lập và không bao giờ truy cập vào production hay làm lộ thông tin nhạy cảm, để tôi tin tưởng giao code cho nền tảng.

#### Acceptance Criteria

1. THE **SandboxExecutor** SHALL chạy mọi lệnh AI trong môi trường container cô lập với giới hạn tài nguyên: CPU tối đa 2 cores, RAM tối đa 4GB, disk tối đa 10GB, và thời gian chạy tối đa 30 phút mỗi AITask.
2. THE **SandboxExecutor** SHALL không cho phép kết nối mạng từ sandbox tới cơ sở dữ liệu production, hạ tầng production, hoặc bất kỳ endpoint nội bộ nào — chỉ cho phép kết nối tới GitHub và registry package manager.
3. THE **CodingAgent** SHALL không bao giờ đọc, ghi, hoặc commit các file chứa secrets (phát hiện dựa trên pattern matching với danh sách entropy-based patterns đã định nghĩa).
4. IF **SandboxExecutor** phát hiện tác vụ vượt quá giới hạn tài nguyên, THEN THE **SandboxExecutor** SHALL kết thúc tác vụ ngay lập tức, ghi nhật ký sự kiện, và chuyển AITask sang FAILED với lý do cụ thể.
5. THE **CodingAgent** SHALL tạo audit log đầy đủ ghi lại mọi lệnh thực thi, file được đọc/ghi, và hành động thực hiện — audit log này không thể bị xóa bởi bất kỳ tác nhân AI nào.
6. THE **SandboxExecutor** SHALL xóa hoàn toàn workspace cô lập sau khi AITask hoàn thành hoặc thất bại, không lưu lại bất kỳ dữ liệu nào từ codebase khách hàng trên đĩa.

---

### Requirement 13: Tạo Pull Request và Quản Lý Nhánh Git

**User Story:** Với tư cách là khách hàng, tôi muốn nhận Pull Request được tạo tự động sau khi AI hoàn thành thay đổi, để tôi có thể xem xét và merge khi sẵn sàng.

#### Acceptance Criteria

1. WHEN **CodingAgent** hoàn tất kiểm tra thành công, THE **GitHubIntegration** SHALL tạo Pull Request trên GitHub với tiêu đề, mô tả thay đổi bằng ngôn ngữ thân thiện, danh sách file thay đổi, kết quả test, và liên kết tới Issue trong nền tảng.
2. THE **GitHubIntegration** SHALL tạo nhánh AI theo quy ước đặt tên: `ai/{issueId}-{kebab-case-title}` và không bao giờ push thẳng lên nhánh mặc định của repository.
3. WHEN Pull Request được tạo thành công, THE **Platform** SHALL tạo bản ghi PullRequest liên kết với Issue và AITask, cập nhật trạng thái AITask thành COMPLETED, và gửi thông báo với link trực tiếp tới Pull Request trên GitHub.
4. THE **GitHubIntegration** SHALL đồng bộ trạng thái Pull Request (OPEN, CLOSED, MERGED) từ GitHub thông qua webhook hoặc polling tối đa mỗi 5 phút.
5. WHEN Pull Request được merge bởi khách hàng, THE **Platform** SHALL cập nhật trạng thái Issue thành DEPLOYED và ghi nhận thành công trong Usage metrics.

---

### Requirement 14: Dashboard Tổng Quan

**User Story:** Với tư cách là khách hàng, tôi muốn xem tổng quan nhanh về tất cả dự án, tác vụ đang chạy, và hoạt động AI gần đây, để tôi nắm bắt tình trạng hệ thống của mình trong vài giây.

#### Acceptance Criteria

1. THE **Platform** SHALL cung cấp Dashboard hiển thị: tổng số Project, AITask đang chạy, Issue chờ phê duyệt, tổng chi phí AI trong tháng, và tỷ lệ thành công của AITask.
2. THE **Platform** SHALL cung cấp điều hướng tới: Dashboard, Projects, Issues, AI Tasks, Pull Requests, Usage & Billing, Settings.
3. WHEN khách hàng truy cập Dashboard, THE **Platform** SHALL tải và hiển thị dữ liệu trong vòng 2 giây với dữ liệu không quá 5 phút tuổi.
4. THE **Platform** SHALL hiển thị feed hoạt động AI gần đây gồm tối đa 20 sự kiện mới nhất với timestamp, loại sự kiện, và project liên quan.
5. THE **Platform** SHALL hiển thị ước tính tiết kiệm chi phí so sánh với chi phí thuê developer thủ công dựa trên số Issue đã hoàn thành thành công.

---

### Requirement 15: Trang Chi Tiết Dự Án

**User Story:** Với tư cách là khách hàng, tôi muốn xem thông tin kỹ thuật tổng quan về dự án của mình bằng ngôn ngữ dễ hiểu, để tôi biết AI hiểu dự án của mình đến mức nào.

#### Acceptance Criteria

1. THE **Platform** SHALL hiển thị trang chi tiết Project với các tab: Overview, Issues, Architecture, AI Tasks, Pull Requests, Activity.
2. WHILE tab Architecture đang hiển thị, THE **Platform** SHALL trình bày thông tin: framework, ngôn ngữ, cơ sở dữ liệu, dependencies chính, modules được phát hiện, coverage test, build status, và điểm AI Support Score — tất cả bằng ngôn ngữ thân thiện với người không có kiến thức kỹ thuật.
3. THE **Platform** SHALL hiển thị trạng thái phân tích Project (PENDING, ANALYZING, COMPLETED, FAILED) và thời gian phân tích gần nhất.
4. WHEN khách hàng yêu cầu phân tích lại, THE **ProjectService** SHALL cho phép kích hoạt lại PROJECT_ANALYSIS với điều kiện không có AITask nào đang chạy cho project đó.

---

### Requirement 16: Trang Chi Tiết Issue

**User Story:** Với tư cách là khách hàng, tôi muốn xem toàn bộ vòng đời của một yêu cầu — từ mô tả ban đầu đến kết quả thực thi — trong một giao diện nhất quán, để tôi không bao giờ mất thông tin về những gì đã được làm.

#### Acceptance Criteria

1. THE **Platform** SHALL hiển thị trang chi tiết Issue với: tiêu đề, mô tả gốc của khách hàng, chẩn đoán AI, danh sách file bị ảnh hưởng, mức rủi ro, mức độ phức tạp, kế hoạch triển khai, ước tính chi phí, và giá khách hàng.
2. WHEN Issue ở trạng thái sau thực thi (COMPLETED hoặc FAILED), THE **Platform** SHALL hiển thị thêm: danh sách file đã thay đổi, kết quả test, kết quả build, tóm tắt AI review, và link Pull Request.
3. THE **Platform** SHALL hiển thị timeline trạng thái trực quan cho thấy toàn bộ lịch sử chuyển tiếp trạng thái của Issue với timestamp và mô tả thân thiện cho từng bước.
4. WHEN AITask đang ở trạng thái CODING, TESTING, hoặc FIXING, THE **Platform** SHALL tự động cập nhật tiến độ bằng polling mỗi 10 giây mà không cần làm mới trang.

---

### Requirement 17: Nhật Ký Hoạt Động AI

**User Story:** Với tư cách là khách hàng, tôi muốn xem nhật ký chi tiết về những gì AI đã làm với code của mình, để tôi có thể kiểm tra và tin tưởng vào quá trình.

#### Acceptance Criteria

1. THE **ActivityLogger** SHALL ghi nhật ký mọi sự kiện đáng kể trong vòng đời AITask: thay đổi trạng thái, lệnh thực thi, file được thay đổi, kết quả test, lỗi xảy ra, và thao tác GitHub.
2. THE **Platform** SHALL hiển thị nhật ký hoạt động theo hai cấp độ: log thân thiện với khách hàng (ngôn ngữ thường ngày, ẩn chi tiết kỹ thuật) và log kỹ thuật chi tiết cho debug nội bộ.
3. THE **ActivityLogger** SHALL đính kèm metadata chuẩn cho mọi bản ghi log: taskId, organizationId, projectId, issueId, tác nhân AI, model AI, lượng token sử dụng, chi phí ước tính, thời gian thực thi, và trạng thái.
4. THE **Platform** SHALL lưu giữ nhật ký hoạt động tối thiểu 90 ngày và hỗ trợ tìm kiếm/lọc theo projectId, issueId, trạng thái, và khoảng thời gian.

---

### Requirement 18: Theo Dõi Sử Dụng và Thanh Toán

**User Story:** Với tư cách là khách hàng, tôi muốn xem báo cáo sử dụng AI và chi phí tích lũy theo thời gian, để tôi kiểm soát ngân sách và hiểu giá trị nhận được.

#### Acceptance Criteria

1. THE **Platform** SHALL ghi nhận Usage bao gồm: số AITask thực thi, tổng token AI tiêu thụ, chi phí AI nội bộ, và giá khách hàng theo Organization và theo tháng.
2. THE **Platform** SHALL hiển thị trang Usage & Billing với: tổng chi phí tháng hiện tại, biểu đồ chi phí theo thời gian, phân tích chi phí theo Project và Issue, và lịch sử thanh toán.
3. THE **Platform** SHALL không bao giờ hiển thị chi phí AI nội bộ (giá thành) cho khách hàng — chỉ hiển thị giá khách hàng đã được PricingService tính toán.
4. WHEN tổng chi phí tháng của một Organization đạt 80% hạn mức sử dụng, THE **Platform** SHALL gửi cảnh báo qua email và hiển thị banner thông báo trong dashboard.
5. IF tổng chi phí tháng vượt quá hạn mức sử dụng, THEN THE **Platform** SHALL tạm dừng khả năng tạo Issue mới và yêu cầu nâng cấp gói hoặc thanh toán bổ sung trước khi tiếp tục.

---

### Requirement 19: Xử Lý Hàng Đợi và Tác Vụ Nền

**User Story:** Với tư cách là khách hàng, tôi muốn API phản hồi ngay lập tức ngay cả khi tác vụ AI cần nhiều thời gian, để giao diện luôn mượt mà và không bị treo.

#### Acceptance Criteria

1. THE **QueueService** SHALL sử dụng BullMQ với Redis để quản lý các tác vụ chạy lâu: PROJECT_ANALYSIS, AI_ANALYSIS, AI_CODING, SANDBOX_EXECUTION, PR_CREATION.
2. WHEN một API endpoint enqueue tác vụ nền, THE **Platform** SHALL trả về response HTTP 202 Accepted ngay lập tức kèm jobId để theo dõi tiến độ.
3. THE **QueueService** SHALL hỗ trợ retry tự động với exponential backoff: lần 1 sau 30 giây, lần 2 sau 2 phút, lần 3 sau 10 phút — trước khi đánh dấu tác vụ là FAILED.
4. THE **QueueService** SHALL giới hạn số lượng tác vụ AI_CODING chạy đồng thời tối đa 5 tác vụ trên toàn hệ thống trong MVP để kiểm soát chi phí và tài nguyên.
5. IF một worker xử lý tác vụ bị crash, THEN THE **QueueService** SHALL tự động chuyển tác vụ sang worker khác mà không mất dữ liệu, nhờ cơ chế acknowledgment của BullMQ.

---

### Requirement 20: Xử Lý Lỗi và Khả Năng Phục Hồi

**User Story:** Với tư cách là khách hàng, tôi muốn nhận thông báo rõ ràng khi có lỗi xảy ra và biết các bước tiếp theo, để tôi không bị bỏ lại với lỗi kỹ thuật khó hiểu.

#### Acceptance Criteria

1. THE **Platform** SHALL hiển thị thông báo lỗi bằng ngôn ngữ thân thiện với khách hàng, không bao giờ hiển thị stack trace kỹ thuật, SQL error, hoặc thông tin hệ thống nội bộ cho giao diện người dùng.
2. WHEN một AITask thất bại, THE **Platform** SHALL hiển thị: mô tả vấn đề bằng tiếng thường, bước đã thất bại, và tối thiểu một hành động tiếp theo có thể thực hiện (thử lại, chỉnh sửa yêu cầu, liên hệ hỗ trợ).
3. THE **Platform** SHALL ghi lại toàn bộ thông tin lỗi kỹ thuật (stack trace, context, input data) vào hệ thống log nội bộ với mức severity thích hợp.
4. IF một tác vụ AI bị gián đoạn do sự cố hạ tầng, THEN THE **QueueService** SHALL tự động phục hồi tác vụ từ checkpoint gần nhất khi hạ tầng khôi phục.
5. THE **Platform** SHALL báo cáo tỷ lệ lỗi AITask cho team vận hành qua structured log với alert khi tỷ lệ lỗi vượt 10% trong vòng 1 giờ.

---

### Requirement 21: Lớp Trừu Tượng AI Provider

**User Story:** Với tư cách là nhóm phát triển, chúng tôi muốn có khả năng thay đổi nhà cung cấp AI mà không ảnh hưởng đến toàn bộ hệ thống, để tránh lock-in vào một nhà cung cấp duy nhất.

#### Acceptance Criteria

1. THE **AIProvider** SHALL cung cấp interface thống nhất cho tất cả tác nhân AI (AIAnalysisAgent, PlanningAgent, CodingAgent) để gọi model AI, không phụ thuộc trực tiếp vào SDK của nhà cung cấp cụ thể.
2. THE **AIProvider** SHALL hỗ trợ ít nhất hai nhà cung cấp có thể cấu hình: OpenAI và Anthropic — với khả năng chuyển đổi qua biến môi trường mà không cần thay đổi code.
3. THE **AIProvider** SHALL ghi nhận lượng token đầu vào, token đầu ra, model sử dụng, và chi phí ước tính cho mỗi lần gọi vào ActivityLog.
4. THE **AIProvider** SHALL xác thực mọi response từ AI theo JSON schema đã định nghĩa và ném exception có cấu trúc khi response không hợp lệ thay vì để lỗi lan rộng.
5. IF một nhà cung cấp AI trả về lỗi rate limit (429), THEN THE **AIProvider** SHALL tự động thực hiện retry với exponential backoff tối đa 3 lần trước khi báo lỗi lên tầng trên.

---

### Requirement 22: Kiến Trúc Đa Thuê Bao và Bảo Mật Dữ Liệu

**User Story:** Với tư cách là khách hàng doanh nghiệp, tôi muốn đảm bảo dữ liệu của công ty tôi được cô lập hoàn toàn khỏi các khách hàng khác, để bảo mật thông tin kinh doanh của mình.

#### Acceptance Criteria

1. THE **Platform** SHALL áp dụng kiểm tra phân quyền tại tầng service cho mọi thao tác trên tài nguyên — không tin tưởng vào tham số ID từ client mà không xác thực quyền sở hữu.
2. THE **Platform** SHALL sử dụng UUID (không phải auto-increment integer) cho mọi định danh tài nguyên công khai để ngăn chặn enumeration attacks.
3. THE **Platform** SHALL không bao giờ trả về dữ liệu từ Organization A khi request được xác thực cho Organization B — mọi query cơ sở dữ liệu phải bao gồm điều kiện lọc `organizationId`.
4. THE **Platform** SHALL áp dụng HTTPS bắt buộc cho mọi giao tiếp API, sử dụng TLS 1.2 trở lên.
5. THE **Platform** SHALL không bao giờ lưu trữ secrets, API keys, hoặc thông tin xác thực dạng plaintext trong cơ sở dữ liệu — mọi giá trị nhạy cảm phải được mã hóa trước khi lưu.

---

### Requirement 23: Thiết Kế API RESTful

**User Story:** Với tư cách là nhóm phát triển frontend, chúng tôi muốn có API nhất quán, có tài liệu rõ ràng, và xác thực đầu vào đầy đủ, để xây dựng giao diện người dùng hiệu quả.

#### Acceptance Criteria

1. THE **Platform** SHALL sử dụng kiến trúc REST với convention: `GET` để đọc, `POST` để tạo, `PATCH` để cập nhật một phần, `DELETE` để xóa — và trả về HTTP status code chuẩn cho từng trường hợp.
2. THE **Platform** SHALL xác thực mọi request đầu vào bằng DTO (Data Transfer Object) với class-validator trước khi business logic xử lý, trả về lỗi 400 với danh sách lỗi validation cụ thể.
3. THE **Platform** SHALL không để business logic trong controllers — controllers chỉ nhận request, gọi service, và trả về response.
4. THE **Platform** SHALL cung cấp tài liệu API tự động qua OpenAPI/Swagger, cập nhật theo thay đổi code, và có thể truy cập tại endpoint `/api/docs`.
5. THE **Platform** SHALL áp dụng rate limiting: 100 request/phút cho API thông thường và 10 request/phút cho các endpoint tạo Issue và kích hoạt AI task.

---

### Requirement 24: Cơ Sở Dữ Liệu và Tính Toàn Vẹn Dữ Liệu

**User Story:** Với tư cách là nhóm phát triển, chúng tôi muốn cơ sở dữ liệu có cấu trúc rõ ràng, hiệu suất tốt, và dữ liệu luôn nhất quán, để hệ thống vận hành ổn định lâu dài.

#### Acceptance Criteria

1. THE **Platform** SHALL sử dụng Prisma ORM với PostgreSQL, đảm bảo mọi migration đều có thể rollback và được phiên bản hóa trong version control.
2. THE **Platform** SHALL tạo index trên các cột: `organizationId`, `projectId`, `issueId`, `taskId`, `createdAt`, `status` cho mọi bảng liên quan để đảm bảo hiệu suất query.
3. THE **Platform** SHALL sử dụng UUID v4 cho mọi primary key và foreign key công khai.
4. THE **Platform** SHALL áp dụng soft delete (trường `deletedAt`) cho các entity: Organization, Project, Issue, User — không bao giờ xóa vĩnh viễn trực tiếp qua API.
5. THE **Platform** SHALL tự động ghi `createdAt` và `updatedAt` timestamp cho mọi bảng và không bao giờ cho phép client ghi đè các trường này.
6. THE **Platform** SHALL không bao giờ lưu giá trị secrets hoặc thông tin xác thực dạng raw trong bất kỳ bảng nào của cơ sở dữ liệu.

---

### Requirement 25: Tiêu Chuẩn Code và Kiến Trúc Phần Mềm

**User Story:** Với tư cách là nhóm phát triển, chúng tôi muốn codebase tuân theo các tiêu chuẩn nhất quán, để dễ bảo trì và mở rộng trong tương lai.

#### Acceptance Criteria

1. THE **Platform** SHALL sử dụng TypeScript strict mode (`"strict": true`) trong toàn bộ codebase frontend và backend, và không cho phép sử dụng kiểu `any` mà không có lý do rõ ràng được comment.
2. THE **Platform** SHALL tổ chức backend theo module NestJS với cấu trúc: controller → service → repository, và không để business logic trong controller hoặc component giao diện.
3. THE **Platform** SHALL đặt mọi cấu hình (database URL, API keys, port, thresholds) trong biến môi trường với kiểm tra tại startup — không hard-code bất kỳ giá trị cấu hình nào trong code.
4. THE **Platform** SHALL đặt mọi AI prompt vào các lớp riêng biệt: ProjectAnalysisPrompt, IssueAnalysisPrompt, PlanningPrompt, CodingPrompt, ReviewPrompt — và không nhúng prompt trực tiếp vào service logic.
5. THE **Platform** SHALL đặt mọi tích hợp bên ngoài (GitHub, AI providers, email) sau interface trừu tượng để cho phép thay thế và mock trong testing.

---

## Tóm Tắt Phạm Vi MVP

Tài liệu này bao gồm 25 nhóm yêu cầu bao phủ toàn bộ phạm vi MVP được đề ra:

| # | Nhóm Yêu Cầu | Phạm Vi |
|---|---|---|
| 1 | Xác thực người dùng | Đăng ký, đăng nhập, JWT, OAuth GitHub |
| 2 | Quản lý tổ chức đa thuê bao | Organizations, roles, multi-tenancy |
| 3 | Kết nối GitHub | GitHub App, repository selection |
| 4 | Phân tích dự án tự động | ProjectAnalyzer, codebase inspection |
| 5 | Điểm tương thích | CompatibilityScorer, 4 mức phân loại |
| 6 | Tạo Issue ngôn ngữ tự nhiên | IssueService, 7 loại Issue |
| 7 | Phân tích AI và lập kế hoạch | AIAnalysisAgent, PlanningAgent |
| 8 | Ước tính chi phí minh bạch | PricingService, CostEstimate |
| 9 | Luồng phê duyệt khách hàng | ApprovalService, không AI trước phê duyệt |
| 10 | Máy trạng thái AITask | 14 trạng thái, ActivityLogger |
| 11 | CodingAgent viết code | Sandbox, thực thi, test, commit |
| 12 | An toàn sandbox | Giới hạn tài nguyên, audit log |
| 13 | Pull Request và Git | Tạo PR, không merge trực tiếp |
| 14 | Dashboard tổng quan | 5 tab điều hướng, metrics |
| 15 | Trang chi tiết dự án | Architecture, AI score |
| 16 | Trang chi tiết Issue | Timeline, live update |
| 17 | Nhật ký hoạt động AI | ActivityLogger, 2 cấp độ log |
| 18 | Theo dõi sử dụng và thanh toán | Usage, billing, hạn mức |
| 19 | Hàng đợi và tác vụ nền | BullMQ, Redis, retry |
| 20 | Xử lý lỗi và phục hồi | Customer-friendly errors, recovery |
| 21 | Lớp trừu tượng AI Provider | AIProvider interface, multi-provider |
| 22 | Bảo mật đa thuê bao | Authorization, UUID, HTTPS |
| 23 | API RESTful | REST, DTO validation, OpenAPI |
| 24 | Cơ sở dữ liệu | Prisma, PostgreSQL, indexes |
| 25 | Tiêu chuẩn code | TypeScript strict, NestJS modules |
