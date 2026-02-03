from django.urls import path

from . import views

urlpatterns = [
    path('', views.event_list, name='event_list'),
    path('events/new', views.event_create, name='event_create'),
    path('events/<int:event_id>', views.event_detail, name='event_detail'),
    path('events/<int:event_id>/upload', views.video_upload, name='video_upload'),
    path('videos/<int:video_id>', views.video_detail, name='video_detail'),
    path('videos/<int:video_id>/file', views.video_serve, name='video_serve'),
    path('videos/<int:video_id>/analyse', views.analysis_create, name='analysis_create'),
    path('analyses/<int:analysis_id>', views.analysis_detail, name='analysis_detail'),
    path('analyses/<int:analysis_id>/marks', views.analysis_save_marks, name='analysis_save_marks'),
]
